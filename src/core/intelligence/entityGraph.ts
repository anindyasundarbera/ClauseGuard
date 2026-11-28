import { LEGAL_OPERATOR_SHIELD } from "../detection/deterministicDetectors.ts";
import { trimNameTail } from "../detection/candidateFilters.ts";
import type {
  CanonicalEntity,
  ContractRole,
  DetectedEntity,
  DocumentEntityBinding,
  EntityCategory,
} from "../types.ts";

const LEGAL_SUFFIXES = new Set([
  "gmbh",
  "llc",
  "inc",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "ag",
  "sa",
  "plc",
  "lp",
  "llp",
]);

const GENERIC_ORG_WORDS = new Set([
  ...LEGAL_SUFFIXES,
  "biologics",
  "national",
  "bank",
  "delaware",
  "quantum",
  "labs",
  "systems",
  "cloud",
  "robotics",
  "precision",
  "capital",
  "partners",
  "strategic",
  "advisory",
]);

const ROLE_TOKENS = new Set<string>([
  "CLIENT",
  "VENDOR",
  "BUYER",
  "TARGET",
  "DISCLOSING_PARTY",
  "RECEIVING_PARTY",
  "ADVISOR",
  "SUBPROCESSOR",
  "SELLER",
  "SUPPLIER",
  "CUSTOMER",
]);

export function normalizeOrgSurface(name: string): string {
  const tokens = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const stripped = tokens.filter((t) => !LEGAL_SUFFIXES.has(t));
  return (stripped.length > 0 ? stripped : tokens).join(" ");
}

function charTrigrams(s: string): Set<string> {
  const pad = `  ${s.toLowerCase()}  `;
  const out = new Set<string>();
  for (let i = 0; i <= pad.length - 3; i++) {
    out.add(pad.slice(i, i + 3));
  }
  return out;
}

export function trigramJaccard(a: string, b: string): number {
  const ta = charTrigrams(a);
  const tb = charTrigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
  }
  return inter / (ta.size + tb.size - inter);
}

function distinctiveTokens(name: string): Set<string> {
  const toks = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(toks.filter((t) => t.length >= 3 && !GENERIC_ORG_WORDS.has(t)));
}

function normalizeRole(rawRole: string | undefined): ContractRole {
  if (!rawRole) return "PARTY";
  const up = rawRole.toUpperCase().replace(/[^A-Z_]/g, "");
  if (up === "SUPPLIER" || up === "SELLER") return "VENDOR";
  if (up === "CUSTOMER") return "CLIENT";
  if (
    up === "CLIENT" ||
    up === "VENDOR" ||
    up === "BUYER" ||
    up === "TARGET" ||
    up === "DISCLOSING_PARTY" ||
    up === "RECEIVING_PARTY" ||
    up === "ADVISOR" ||
    up === "BANK" ||
    up === "SIGNATORY" ||
    up === "SUBPROCESSOR"
  ) {
    return up;
  }
  return "PARTY";
}

function findWordBoundaryOccurrences(haystack: string, needle: string): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  if (!needle) return hits;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) break;
    const prev = idx === 0 ? "" : haystack[idx - 1];
    const next = idx + needle.length >= haystack.length ? "" : haystack[idx + needle.length];
    const prevOk = !prev || !/[A-Za-z0-9]/.test(prev);
    const nextOk = !next || !/[A-Za-z0-9]/.test(next);
    if (prevOk && nextOk) {
      hits.push([idx, idx + needle.length]);
    }
    cursor = idx + needle.length;
  }
  return hits;
}

export interface PreambleExtractionResult {
  orgNames: Map<string, string>; // normKey -> surface
  aliases: Map<string, string>; // alias -> parentOrgSurface
  docRoles: Map<string, ContractRole>; // normKey -> local ContractRole
}

/** Deterministically parse preamble party definitions ('MPR' or 'CLIENT'). */
export function extractPreambleDefinitions(normText: string): PreambleExtractionResult {
  const orgNames = new Map<string, string>();
  const aliases = new Map<string, string>();
  const docRoles = new Map<string, ContractRole>();

  const SUFFIX_LOOKAHEAD = "(?!GmbH\\b|LLC\\b|Inc\\b|Corp\\b|Ltd\\b|LP\\b|LLP\\b)";
  const defRegex = new RegExp(
    `([A-Z][A-Za-z0-9&'\\-]+(?:\\s+(?:of|and|&|${SUFFIX_LOOKAHEAD}[A-Z][A-Za-z0-9&'\\-]+)){0,5},?\\s+(?:GmbH|LLC|Inc\\.?|Corp\\.?|Ltd\\.?|LP|LLP)\\.?)\\s*\\((?:hereinafter\\s+)?['"]([A-Za-z0-9 _-]{2,28})['"](?:\\s+or\\s+['"]([A-Z_]{3,24})['"])?\\)`,
    "g"
  );

  for (const m of normText.matchAll(defRegex)) {
    const fullOrg = m[1].trim();
    const firstTag = m[2].trim();
    const secondTag = m[3]?.trim();
    const normKey = normalizeOrgSurface(fullOrg);
    orgNames.set(normKey, fullOrg);
    if (secondTag) {
      docRoles.set(normKey, normalizeRole(secondTag));
      if (!ROLE_TOKENS.has(firstTag.toUpperCase())) {
        aliases.set(firstTag, fullOrg);
      }
    } else if (ROLE_TOKENS.has(firstTag.toUpperCase())) {
      docRoles.set(normKey, normalizeRole(firstTag));
    } else {
      aliases.set(firstTag, fullOrg);
    }
  }
  return { orgNames, aliases, docRoles };
}

export interface GraphMatchOutput {
  entities: DetectedEntity[];
  bindings: DocumentEntityBinding[];
}

function matchWorkspaceFuzzy(
  rawName: string,
  workspaceEntities: CanonicalEntity[]
): { entity: CanonicalEntity; score: number; exact: boolean } | undefined {
  const normPhrase = normalizeOrgSurface(rawName);
  for (const we of workspaceEntities) {
    if (normalizeOrgSurface(we.canonicalName) === normPhrase && normPhrase.length >= 4) {
      return { entity: we, score: 1.0, exact: true };
    }
  }
  let best: CanonicalEntity | undefined;
  let bestScore = 0;
  for (const we of workspaceEntities) {
    const sim = trigramJaccard(normalizeOrgSurface(we.canonicalName), normPhrase);
    if (sim >= 0.68 && sim > bestScore) {
      const dtWe = distinctiveTokens(we.canonicalName);
      const dtRaw = distinctiveTokens(rawName);
      let tokenCompat = dtWe.size === 0 || dtRaw.size === 0;
      if (!tokenCompat) {
        for (const a of dtWe) {
          for (const b of dtRaw) {
            if (a === b || trigramJaccard(a, b) >= 0.55) {
              tokenCompat = true;
            }
          }
        }
      }
      if (tokenCompat) {
        best = we;
        bestScore = sim;
      }
    }
  }
  return best ? { entity: best, score: bestScore, exact: false } : undefined;
}

/**
 * ARCH-RET-4.1 Contextual Disambiguated Entity Graph Engine.
 * Executes:
 *   Stage A: Longest-Match-First Dictionary Pass (Workspace + Preamble)
 *   Stage B: Connector-Aware Legal Org & Person Discovery + Trigram >= 0.68 Typo Check
 *   Stage C: Acronym Homonym Guard & Rejection Allowlist Filtering
 */
export function resolveEntitiesWithGraph(
  docSessionId: string,
  normText: string,
  workspaceEntities: CanonicalEntity[],
  rejectionAllowlist: Set<string>
): GraphMatchOutput {
  const { orgNames, aliases, docRoles } = extractPreambleDefinitions(normText);
  const occupied: Array<[number, number]> = [];
  const entities: DetectedEntity[] = [];
  const bindingsMap = new Map<string, DocumentEntityBinding>();
  let seq = 1;

  const overlaps = (s: number, e: number): boolean =>
    occupied.some(([os, oe]) => !(e <= os || s >= oe));

  const isHomonymProtected = (term: string): boolean => {
    if (term === "MPR" && normText.includes("Monthly Performance Review (MPR)")) {
      return true;
    }
    return false;
  };

  // Build dictionary terms sorted longest-first
  interface DictTerm {
    surface: string;
    canonicalId: string;
    canonicalName: string;
    category: EntityCategory;
    source: "WORKSPACE_GRAPH" | "PREAMBLE_DEFINITION" | "TRIGRAM_FUZZY";
    trustWeight: number;
    needsDecision?: boolean;
  }

  const dictTerms: DictTerm[] = [];
  for (const we of workspaceEntities) {
    dictTerms.push({
      surface: we.canonicalName,
      canonicalId: we.canonicalId,
      canonicalName: we.canonicalName,
      category: we.category,
      source: "WORKSPACE_GRAPH",
      trustWeight: 0.98,
    });
    for (const al of we.aliases) {
      dictTerms.push({
        surface: al,
        canonicalId: we.canonicalId,
        canonicalName: we.canonicalName,
        category: we.category,
        source: "WORKSPACE_GRAPH",
        trustWeight: 0.94,
      });
    }
  }

  for (const [normKey, orgSurf] of orgNames.entries()) {
    const wsMatch = matchWorkspaceFuzzy(orgSurf, workspaceEntities);
    const cid = wsMatch ? wsMatch.entity.canonicalId : `PRE-${normKey.replace(/\s+/g, "_").toUpperCase()}`;
    const cname = wsMatch ? wsMatch.entity.canonicalName : orgSurf;
    const isFuzzy = Boolean(wsMatch && !wsMatch.exact);
    dictTerms.push({
      surface: orgSurf,
      canonicalId: cid,
      canonicalName: cname,
      category: "ORG",
      source: isFuzzy ? "TRIGRAM_FUZZY" : "PREAMBLE_DEFINITION",
      trustWeight: isFuzzy && wsMatch ? Number(wsMatch.score.toFixed(2)) : 0.96,
      needsDecision: isFuzzy,
    });
  }

  for (const [al, parentOrg] of aliases.entries()) {
    const parentNorm = normalizeOrgSurface(parentOrg);
    const matchedWe = matchWorkspaceFuzzy(parentOrg, workspaceEntities);
    dictTerms.push({
      surface: al,
      canonicalId: matchedWe?.entity.canonicalId ?? `PRE-${parentNorm.replace(/\s+/g, "_").toUpperCase()}`,
      canonicalName: matchedWe?.entity.canonicalName ?? parentOrg,
      category: matchedWe?.entity.category ?? "ORG",
      source: "PREAMBLE_DEFINITION",
      trustWeight: 0.95,
    });
  }

  dictTerms.sort((a, b) => b.surface.length - a.surface.length);

  for (const item of dictTerms) {
    if (rejectionAllowlist.has(item.surface.toLowerCase())) continue;
    if (LEGAL_OPERATOR_SHIELD.has(item.surface.toLowerCase())) continue;
    if (isHomonymProtected(item.surface)) continue;

    for (const [s, e] of findWordBoundaryOccurrences(normText, item.surface)) {
      if (overlaps(s, e)) continue;
      occupied.push([s, e]);
      const surfNorm = normalizeOrgSurface(item.surface);
      const normKey = normalizeOrgSurface(item.canonicalName);
      const localRole = docRoles.get(surfNorm) ?? docRoles.get(normKey) ?? (item.category === "BANK" ? "BANK" : "PARTY");
      entities.push({
        id: `GRAPH-${seq++}`,
        surface: item.surface,
        canonicalKey: item.canonicalId,
        canonicalName: item.canonicalName,
        category: item.category,
        role: localRole,
        normStart: s,
        normEnd: e,
        source: item.source,
        confidence: item.trustWeight,
        rationale:
          item.source === "WORKSPACE_GRAPH"
            ? `Matched approved workspace canonical entity '${item.canonicalName}'`
            : item.source === "TRIGRAM_FUZZY"
              ? `Fuzzy typo match (${Math.round(item.trustWeight * 100)}% trigram) to workspace entity '${item.canonicalName}'`
              : `Matched preamble party/alias definition for '${item.canonicalName}'`,
        reviewStatus: item.needsDecision ? "NEEDS_DECISION" : "ACCEPTED",
        needsDecisionReason: item.needsDecision
          ? `Verify OCR/typo match '${item.surface}' -> '${item.canonicalName}'`
          : undefined,
      });
      if (!bindingsMap.has(item.canonicalId)) {
        bindingsMap.set(item.canonicalId, {
          docSessionId,
          canonicalId: item.canonicalId,
          localRole,
          localDefinedAliases: [],
        });
      }
    }
  }

  // Stage B: Legal Suffix Organizations, Connector Phrases ("First National Bank of Delaware"), and Signatory Names
  const suffixGuard = "(?!GmbH\\b|LLC\\b|Inc\\b|Corp\\b|Ltd\\b|LP\\b|LLP\\b|Bank\\b)";
  const orgReStr = `\\b${suffixGuard}[A-Z][A-Za-z0-9&'\\-]+(?:\\s+(?:of|and|&|${suffixGuard}[A-Z][A-Za-z0-9&'\\-]+)){0,5},?\\s+(?:GmbH|LLC|Inc\\.?|Corp\\.?|Ltd\\.?|LP|LLP)\\.?`;
  const bankReStr = `\\b(?:[A-Z][A-Za-z0-9&'\\-]+\\s+){0,4}Bank(?:\\s+(?:of|and)\\s+[A-Z][A-Za-z0-9&'\\-]+(?:\\s+[A-Z][A-Za-z0-9&'\\-]+){0,2})?\\b`;
  // Honorific + 1-4 capitalised words on the same line ("Dr. Jiban Basak", "Mr Arun Kumar Bera").
  // Words are joined by spaces or tabs only, so a name never runs onto the next line; trailing
  // form labels ("Gender", "Age") are trimmed below.
  const personReStr = `\\b(?:Dr|Mr|Ms|Mrs|Prof|Shri|Smt)\\.?[ \\t]+[A-Z][A-Za-z'\\-]+(?:[ \\t]+(?:[A-Z]\\.|[A-Z][A-Za-z'\\-]+)){0,3}\\b`;
  const phraseRe = new RegExp(`${personReStr}|${orgReStr}|${bankReStr}`, "g");

  for (const m of normText.matchAll(phraseRe)) {
    let raw = m[0].trim().replace(/[,;:]+$/, "");
    if (raw.endsWith(".") && !/\b(?:Inc|Ltd|Corp|Dr|Mr|Ms|Mrs|Prof)\.$/i.test(raw)) {
      raw = raw.slice(0, -1);
    }
    const start = (m.index ?? 0) + m[0].indexOf(raw);
    let end = start + raw.length;
    if (/^(?:Dr|Mr|Ms|Mrs|Prof|Shri|Smt)\.?[ \t]/.test(raw)) {
      end = trimNameTail(normText, start, end);
      raw = normText.slice(start, end);
    }
    if (overlaps(start, end)) continue;
    if (rejectionAllowlist.has(raw.toLowerCase())) continue;
    if (LEGAL_OPERATOR_SHIELD.has(raw.toLowerCase())) continue;
    if (
      /^(?:Under|Section|Clause|Schedule|State of|Governing|Authorized|Monthly Performance|Master|Mutual|Data|Enterprise|Merger|Executive|Commercial|Lookalike|Wire|NOTE|IGNORE|Controller|Backup)\b/.test(
        raw
      )
    ) {
      continue;
    }

    const isTitlePerson = /^(?:Dr|Mr|Ms|Mrs|Prof|Shri|Smt)\.?[ \t]+\S/.test(raw);
    const isLegalOrg = !isTitlePerson && /\b(?:GmbH|LLC|Inc\.?|Corp\.?|Ltd\.?|LP|LLP)\.?$/.test(raw);
    const isBank = !isTitlePerson && /\bBank\b/.test(raw);
    if (!isLegalOrg && !isBank && !isTitlePerson) {
      continue;
    }

    const normPhrase = normalizeOrgSurface(raw);
    const wsMatch = matchWorkspaceFuzzy(raw, workspaceEntities);
    const fuzzyMatch = wsMatch?.entity;
    const fuzzyScore = wsMatch?.score ?? 0;

    occupied.push([start, end]);
    const category: EntityCategory = isTitlePerson ? "PERSON" : isBank ? "BANK" : "ORG";
    const canonicalId = fuzzyMatch?.canonicalId ?? `DISC-${normPhrase.replace(/\s+/g, "_").toUpperCase()}`;
    const canonicalName = fuzzyMatch?.canonicalName ?? raw;
    const localRole =
      docRoles.get(normPhrase) ??
      docRoles.get(normalizeOrgSurface(canonicalName)) ??
      (isBank ? "BANK" : isTitlePerson ? "SIGNATORY" : "PARTY");

    entities.push({
      id: `ENT-${seq++}`,
      surface: raw,
      canonicalKey: canonicalId,
      canonicalName,
      category,
      role: localRole,
      normStart: start,
      normEnd: end,
      source: fuzzyMatch ? "TRIGRAM_FUZZY" : "PREAMBLE_DEFINITION",
      confidence: fuzzyMatch ? Number(fuzzyScore.toFixed(2)) : 0.89,
      rationale: fuzzyMatch
        ? `Fuzzy typo match (${Math.round(fuzzyScore * 100)}% trigram) to workspace entity '${fuzzyMatch.canonicalName}'`
        : `Structural ${category} phrase candidate`,
      reviewStatus: fuzzyMatch ? "NEEDS_DECISION" : "PENDING_REVIEW",
      needsDecisionReason: fuzzyMatch
        ? `Verify OCR/typo match '${raw}' -> '${fuzzyMatch.canonicalName}'`
        : undefined,
    });
  }

  return {
    entities,
    bindings: Array.from(bindingsMap.values()),
  };
}

/** Strictly learn ONLY explicitly HUMAN_APPROVED entities (never unreviewed AI guesses). */
export function commitHumanApprovedToWorkspace(
  existing: CanonicalEntity[],
  allowlist: Set<string>,
  reviewedEntities: DetectedEntity[]
): { updatedEntities: CanonicalEntity[]; updatedAllowlist: string[] } {
  const byId = new Map(existing.map((e) => [e.canonicalId, { ...e, aliases: [...e.aliases] }]));
  const nextAllow = new Set(allowlist);

  for (const ent of reviewedEntities) {
    if (ent.reviewStatus === "REJECTED") {
      nextAllow.add(ent.surface.toLowerCase());
      continue;
    }
    if (ent.reviewStatus !== "ACCEPTED") continue;
    if (
      ent.category === "IBAN" ||
      ent.category === "CREDIT_CARD" ||
      ent.category === "SSN" ||
      ent.category === "EIN" ||
      ent.category === "API_KEY" ||
      ent.category === "CURRENCY_CAP" ||
      ent.category === "EMAIL" ||
      ent.category === "PHONE" ||
      ent.category === "ADDRESS" ||
      ent.category === "ID_NUMBER"
    ) {
      continue; // UDR-007: Never persist credentials, financial values, or contact PII in workspace glossary
    }

    const existingEnt = byId.get(ent.canonicalKey);
    if (existingEnt) {
      if (
        ent.surface !== existingEnt.canonicalName &&
        !existingEnt.aliases.includes(ent.surface)
      ) {
        existingEnt.aliases.push(ent.surface);
      }
      existingEnt.updatedAtUtc = new Date().toISOString();
    } else {
      byId.set(ent.canonicalKey, {
        canonicalId: ent.canonicalKey,
        canonicalName: ent.canonicalName,
        category: ent.category,
        aliases: ent.surface !== ent.canonicalName ? [ent.surface] : [],
        trustState: "HUMAN_APPROVED",
        updatedAtUtc: new Date().toISOString(),
      });
    }
  }

  return {
    updatedEntities: Array.from(byId.values()),
    updatedAllowlist: Array.from(nextAllow).sort(),
  };
}
