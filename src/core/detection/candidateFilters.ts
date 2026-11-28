import type { EntityCategory } from "../types.ts";

/**
 * Plausibility filters for detection candidates.
 *
 * The on-device model is a small general model. On documents that are not contracts (a hospital
 * report, a lab sheet) it labels lab values, dates, form labels and diagnoses as people, addresses
 * or project names. Its candidates are therefore checked against what each category can look like
 * before they reach the review list. These checks only remove suggestions; anything removed can
 * still be hidden by hand with "Hide something we missed".
 */

/** Form labels and words that commonly follow a name on forms, reports and letters. */
export const NAME_TAIL_LABELS = new Set<string>([
  "age",
  "sex",
  "gender",
  "dob",
  "date",
  "male",
  "female",
  "ward",
  "bed",
  "room",
  "unit",
  "dept",
  "department",
  "consultant",
  "patient",
  "name",
  "id",
  "uhid",
  "mrn",
  "reg",
  "registration",
  "phone",
  "mobile",
  "tel",
  "email",
  "address",
  "signature",
  "sign",
  "designation",
  "ref",
  "referred",
  "admission",
  "discharge",
  "bill",
  "invoice",
  "policy",
  "plan",
  "diagnosis",
  "mbbs",
  "md",
  "ms",
  "dnb",
  "frcs",
  "and",
  "or",
  "the",
  "of",
]);

const HONORIFIC = /^(?:Dr|Mr|Mrs|Ms|Miss|Prof|Shri|Smt|Sri|Kumari)\.?$/i;

/**
 * Return the end offset of a person name after dropping trailing form labels such as
 * "Gender" or "Age", and any word that is directly followed by a colon ("Bera Ward: 4").
 * `text` is the full document; [start, end) is the candidate span.
 */
export function trimNameTail(text: string, start: number, end: number): number {
  const tokens: Array<{ s: number; e: number; w: string }> = [];
  const re = /\S+/g;
  const span = text.slice(start, end);
  for (const m of span.matchAll(re)) {
    const s = start + (m.index ?? 0);
    tokens.push({ s, e: s + m[0].length, w: m[0] });
  }
  const nameWords = (): number => tokens.filter((t) => !HONORIFIC.test(t.w)).length;
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const bare = last.w.replace(/[.,;:]+$/, "").toLowerCase();
    const followedByColon = /^[ \t]*:/.test(text.slice(last.e, last.e + 4)) || last.w.endsWith(":");
    if ((NAME_TAIL_LABELS.has(bare) || followedByColon) && nameWords() > 1) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens.length ? tokens[tokens.length - 1].e : end;
}

/** Self-reported model confidence: accept 0-1 or 0-100; anything else (or 0) means "not given". */
export function normalizeModelConfidence(c: unknown): number | undefined {
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return undefined;
  const v = c > 1 ? c / 100 : c;
  return v > 1 ? undefined : v;
}

const ORG_CUE =
  /\b(?:LLC|LLP|LP|Inc|Corp|Corporation|Co|Company|Ltd|Limited|Pvt|Private|PLC|GmbH|AG|SA|Bank|Hospital|Hospitals|Clinic|Clinics|Medical|Health|Healthcare|Diagnostics|Laboratory|Laboratories|Labs|Pharma|Pharmaceuticals|Insurance|Assurance|University|College|School|Institute|Trust|Foundation|Society|Association|Associates|Group|Holdings|Partners|Services|Solutions|Technologies|Systems|Industries|Enterprises|Centre|Center|Nursing Home)\b/i;

const CONNECTOR = /^(?:of|and|&|the|for|de|von|van|da|bin|al)$/i;

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

function looksLikeDateOrNumberish(s: string): boolean {
  return (
    /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(s) ||
    /^page\s+\d+\s+of\s+\d+$/i.test(s) ||
    /^[\d\s.,:/%+-]+$/.test(s)
  );
}

function isTitleCaseWord(w: string): boolean {
  return /^\p{Lu}[\p{Ll}'’.-]*\p{Ll}[\p{Ll}'’.-]*$/u.test(w) || /^\p{Lu}\.$/u.test(w);
}

function isPlausiblePerson(s: string): boolean {
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  if (!words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w))) return false;
  const hasHonorific = HONORIFIC.test(words[0]);
  const nameWords = hasHonorific ? words.slice(1) : words;
  if (nameWords.length < 1 || nameWords.some((w) => NAME_TAIL_LABELS.has(w.toLowerCase()))) return false;
  if (hasHonorific) return true; // "MR ARUN KUMAR BERA" and "Dr. Jiban Basak" are both fine
  // Without an honorific, require ordinary name casing; all-caps runs are usually headings
  // ("BILATERAL INGUINAL HERNIOPLASTY", "ANAESTHESIA PLAN").
  return nameWords.length >= 2 && nameWords.every(isTitleCaseWord);
}

function isPlausibleAddress(s: string): boolean {
  if (letterCount(s) < 8) return false;
  const commaParts = s.split(",").filter((p) => p.trim().length > 0).length;
  const hasPostcode = /(?<!\d)\d{5,6}(?!\d)/.test(s);
  const hasStreetNumber =
    /\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|nagar|marg|sector|block|flat|house|floor|apartment|apt|village|vill|post|p\.?o|district|dist)\b/i.test(
      s
    );
  return commaParts >= 3 || (commaParts >= 2 && (hasPostcode || hasStreetNumber)) || (hasPostcode && hasStreetNumber);
}

function isPlausibleOrg(s: string): boolean {
  const words = s.split(/\s+/);
  if (words.length > 8) return false;
  if (!words.every((w) => /^[\p{L}\p{N}&'’.,-]+$/u.test(w))) return false;
  if (ORG_CUE.test(s)) return true;
  // Otherwise require a proper-noun shape: at least two capitalised words and nothing lowercase
  // except connectors. Single words ("Eosinophils") and all-caps headings are left out.
  const content = words.filter((w) => !CONNECTOR.test(w));
  return content.length >= 2 && content.every(isTitleCaseWord);
}

/**
 * Check one model candidate. Returns the (possibly trimmed) surface and category to use, or
 * null to drop it. `rawType` is the model's own label; unknown labels are dropped rather than
 * guessed as organisations.
 */
export function vetModelCandidate(
  rawSurface: string,
  rawType: unknown
): { surface: string; category: EntityCategory } | null {
  const surface = rawSurface.trim().replace(/^[,;:\s]+|[,;:\s]+$/g, "");
  if (surface.length < 3 || surface.length > 90) return null;
  if (letterCount(surface) < 2 || looksLikeDateOrNumberish(surface)) return null;
  if (/[:()[\]{}<>=|]/.test(surface)) return null; // "ASA Score : ASA III", "Rate (Esr)"
  if (/\s-\s|\s-$/.test(surface)) return null;

  switch (rawType) {
    case "PERSON": {
      const end = trimNameTail(surface, 0, surface.length);
      const trimmed = surface.slice(0, end);
      return isPlausiblePerson(trimmed) ? { surface: trimmed, category: "PERSON" } : null;
    }
    case "ADDRESS":
      return isPlausibleAddress(surface) ? { surface, category: "ADDRESS" } : null;
    case "CODENAME":
      return /^(?:Project|Operation|Codename)\s+\p{Lu}[\p{L}\p{N}_-]{1,30}$/u.test(surface)
        ? { surface, category: "CODENAME" }
        : null;
    case "ORG":
      return isPlausibleOrg(surface) ? { surface, category: "ORG" } : null;
    default:
      return null;
  }
}

/** Ordinary words that end a name in running text ("DR ANUP KHETAN FROM LAST 15 YEARS"). */
const NAME_STOP_WORDS = new Set<string>([
  ...NAME_TAIL_LABELS,
  "from", "last", "seen", "cleared", "for", "to", "in", "on", "at", "with", "by", "is", "was", "has",
  "had", "have", "under", "since", "adv", "advised", "adviced", "advice", "as", "per", "who", "will",
  "his", "her", "said", "team", "also", "if", "after", "before", "regarding", "re", "cc", "kindly",
  "please", "sent", "visit", "opinion", "consult", "consultation", "follow", "review", "done", "called",
  "informed", "examined", "dr", "mr", "mrs", "ms", "prof", "sir", "madam", "opd", "ipd", "op", "ip",
]);

export interface HonorificName {
  start: number;
  end: number;
}

/**
 * Names written after an honorific ("Dr. Jiban Basak", "Mr Arun Kumar Bera", "DR ANUP KHETAN").
 *
 * In running all-caps notes there is no casing to show where a name ends, so a name ends at an
 * ordinary word ("FROM", "SEEN", "AND"), a form label, a colon, a possessive ("KHETAN'S") or
 * punctuation. When none of those is present ("DR KHETAN IVO SARCOIDOSIS"), the name is cut to
 * the words already seen in a name that did end clearly ("ANUP KHETAN" gives "DR KHETAN").
 * All-caps "MR", "MRS" and "MS" also need two name words, because in clinical notes MR and MS
 * are usually abbreviations (mitral regurgitation, multiple sclerosis).
 */
export function findHonorificNames(text: string): HonorificName[] {
  const re =
    /(?<![\p{L}\p{N}])(Dr|DR|Mr|MR|Mrs|MRS|Ms|MS|Prof|PROF|Shri|SHRI|Smt|SMT)(\.?)[ \t]+(\p{Lu}[\p{L}'’-]*\.?(?:[ \t]+\p{Lu}[\p{L}'’-]*\.?){0,4})/gu;
  type Cand = { start: number; words: Array<{ s: number; e: number; w: string }>; clear: boolean; title: string };
  const cands: Cand[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const namesStart = start + m[0].length - m[3].length;
    const words: Cand["words"] = [];
    let clear = false;
    for (const wm of m[3].matchAll(/\S+/g)) {
      const s = namesStart + (wm.index ?? 0);
      let w = wm[0];
      const bare = w.replace(/[.,]+$/, "").toLowerCase();
      if (NAME_STOP_WORDS.has(bare) || /^[ \t]*:/.test(text.slice(s + w.length, s + w.length + 3))) {
        clear = words.length > 0;
        break;
      }
      const possessive = /['’][sS]$/.test(w);
      if (possessive) w = w.slice(0, -2);
      words.push({ s, e: s + w.length, w });
      if (possessive || /[.,]$/.test(w) && w.length > 2) {
        clear = true;
        break;
      }
      if (words.length === 4) break;
    }
    if (words.length === 0) continue;
    // Drop trailing punctuation ("PAL.", "KHETAN-", "BERA,") but keep a final initial ("Ravi K.").
    const last = words[words.length - 1];
    if (!/^\p{Lu}\.$/u.test(last.w)) {
      const trimmed = last.w.replace(/[.,'’-]+$/, "");
      last.e -= last.w.length - trimmed.length;
      last.w = trimmed;
    }
    if (!clear) {
      // Natural end of the match: next character is a line break or punctuation, not a word.
      const after = text.slice(last.e, last.e + 2);
      clear = /^(?:[ \t]*[\n,;()|]|[ \t]*$)/.test(after) || words.length < 4 && /^[ \t]+\p{Ll}/u.test(after);
    }
    const allCaps = words.every((x) => x.w === x.w.toUpperCase());
    cands.push({ start, words, clear: clear || !allCaps, title: m[1] });
  }

  const knownTokens = new Set<string>();
  for (const c of cands) if (c.clear) for (const x of c.words) knownTokens.add(x.w.replace(/\.$/, "").toUpperCase());

  const out: HonorificName[] = [];
  for (const c of cands) {
    let words = c.words;
    if (!c.clear) {
      let keep = 0;
      while (keep < words.length && knownTokens.has(words[keep].w.replace(/\.$/, "").toUpperCase())) keep++;
      words = words.slice(0, keep > 0 ? keep : Math.min(2, words.length));
    }
    if (/^(?:MR|MRS|MS)$/.test(c.title) && words.length < 2) continue;
    if (words.join("").length < 3) continue;
    out.push({ start: c.start, end: words[words.length - 1].e });
  }
  return out;
}
