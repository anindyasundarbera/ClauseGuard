/**
 * Plain-language view-model helpers. Pure functions only (no DOM, no core mutation) so they can be
 * unit-tested. They translate raw core states (e.g. DEGRADED_DETERMINISTIC_SAFE) into wording a
 * non-technical person can act on. Nothing here weakens or bypasses any privacy gate.
 */
import type {
  ApprovalState,
  ContractFinding,
  DetectedEntity,
  EntityCategory,
  NanoReadinessState,
  ObservedFirebaseTelemetry,
  PrivacyMode,
} from "../core/types.ts";

export type Tone = "ok" | "warn" | "busy" | "neutral";

export interface DeviceAiStatus {
  tone: Tone;
  headline: string;
  help: string;
  /** Whether the one-time model download / set-up button is relevant. */
  canSetUp: boolean;
  /** Short app-bar label. */
  chip: string;
  /** Label for the combined phone chip. */
  phoneChip: string;
  /** Import-screen banner, or null when none is needed. */
  banner: null | { kind: "download" | "downloading"; title: string; body: string; progressPct: number | null };
}

export function describeDeviceAi(state: NanoReadinessState, progressPct: number | null): DeviceAiStatus {
  return { ...describeDeviceAiBase(state, progressPct), ...deviceAiExtras(state, progressPct) };
}

function deviceAiExtras(
  state: NanoReadinessState,
  progressPct: number | null
): Pick<DeviceAiStatus, "chip" | "phoneChip" | "banner"> {
  const pct = progressPct !== null ? ` ${progressPct}%` : "";
  switch (state) {
    case "CHECKING":
      return { chip: "On-device AI: checking…", phoneChip: "Checking…", banner: null };
    case "DOWNLOADABLE_PENDING_WEIGHTS":
      return {
        chip: "On-device AI: download needed",
        phoneChip: "Setup needed",
        banner: {
          kind: "download",
          title: "Get better name detection: download the private AI once",
          body: "It runs only on this device and is kept by your browser. You can start now without it. Built-in rules still find numbers and emails, but may miss names.",
          progressPct: null,
        },
      };
    case "DOWNLOADING":
      return {
        chip: `On-device AI: downloading${pct}`,
        phoneChip: `Downloading${pct}`,
        banner: {
          kind: "downloading",
          title: `Downloading private AI…${pct}`,
          body: "You can keep working. We switch to it when it is ready.",
          progressPct,
        },
      };
    case "READY_ON_DEVICE":
      return { chip: "On-device AI: ready", phoneChip: "Private ✓", banner: null };
    case "OFFLINE":
      return { chip: "On-device AI: offline, using built-in rules", phoneChip: "Built-in rules", banner: null };
    default:
      return { chip: "On-device AI: off, using built-in rules", phoneChip: "Built-in rules", banner: null };
  }
}

function describeDeviceAiBase(
  state: NanoReadinessState,
  progressPct: number | null
): Pick<DeviceAiStatus, "tone" | "headline" | "help" | "canSetUp"> {
  const prefix = "Private AI on this device";
  switch (state) {
    case "READY_ON_DEVICE":
      return {
        tone: "ok",
        headline: `${prefix}: ready`,
        help: "Sensitive details are found on this device before anything else happens.",
        canSetUp: false,
      };
    case "CHECKING":
      return { tone: "busy", headline: `Checking for private AI on this device…`, help: "This takes a moment.", canSetUp: false };
    case "DOWNLOADING":
      return {
        tone: "busy",
        headline: `${prefix}: downloading${progressPct !== null ? ` (${progressPct}%)` : ""}`,
        help: "Until it finishes, we use the safe fallback.",
        canSetUp: false,
      };
    case "DOWNLOADABLE_PENDING_WEIGHTS":
      return {
        tone: "warn",
        headline: `${prefix}: needs a one-time download`,
        help: "Until then we use built-in rules to find sensitive details. Your document still stays on this device.",
        canSetUp: true,
      };
    case "OFFLINE":
      return {
        tone: "warn",
        headline: `${prefix}: not available while offline — using safe fallback`,
        help: "Built-in rules find sensitive details. Your document stays on this device.",
        canSetUp: false,
      };
    case "UNAVAILABLE":
    case "DISABLED":
    case "DEGRADED_DETERMINISTIC_SAFE":
    case "ERROR":
    default:
      return {
        tone: "warn",
        headline: `${prefix}: not available — using safe fallback`,
        help: "Built-in rules find sensitive details instead. Your document still never leaves this device.",
        canSetUp: state !== "ERROR",
      };
  }
}

export function describeCloud(
  t: ObservedFirebaseTelemetry,
  refused = false
): { tone: Tone; headline: string; chip: string } {
  if (!t.hasLiveCloudConfig) {
    return {
      tone: "neutral",
      headline: "Deeper check: cloud not set up, so it runs on this device and nothing is sent",
      chip: "Cloud: not set up",
    };
  }
  if (refused) {
    return {
      tone: "warn",
      headline: "Deeper check: the cloud could not confirm this app is genuine, so nothing was sent",
      chip: "Cloud: blocked",
    };
  }
  return { tone: "ok", headline: "Deeper check: cloud connected and protected", chip: "Cloud: protected" };
}

/** True when the cloud refused the app's App Check attestation (nothing was sent). */
export function isCloudVerificationError(err: unknown): boolean {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /ERR_APP_CHECK|attestation/i.test(raw);
}

export function describeApproval(state: ApprovalState): string {
  switch (state) {
    case "EMPTY":
      return "No document yet";
    case "RAW_INGESTED":
    case "DETECTED":
    case "IN_REVIEW":
      return "Waiting for your review";
    case "PAYLOAD_PREVIEWED":
      return "Ready for your approval";
    case "HUMAN_APPROVED_FOR_CLOUD":
      return "You approved this exact text";
    case "STALE_APPROVAL_INVALIDATED":
      return "Approval reset because something changed";
    case "CLOUD_ANALYZED":
    case "REHYDRATED":
      return "Deeper check finished";
    default:
      return "Unknown";
  }
}

const CATEGORY_LABELS: Record<EntityCategory, [string, string]> = {
  PERSON: ["person's name", "people's names"],
  ORG: ["company or organization", "companies or organizations"],
  CODENAME: ["project name", "project names"],
  BANK: ["bank name", "bank names"],
  EMAIL: ["email address", "email addresses"],
  PHONE: ["phone number", "phone numbers"],
  IBAN: ["bank account number", "bank account numbers"],
  CREDIT_CARD: ["card number", "card numbers"],
  SSN: ["personal ID number", "personal ID numbers"],
  EIN: ["tax ID", "tax IDs"],
  API_KEY: ["secret key", "secret keys"],
  CURRENCY_CAP: ["money amount", "money amounts"],
  ADDRESS: ["street address", "street addresses"],
  ID_NUMBER: ["ID or reference number", "ID or reference numbers"],
  DATE_OF_BIRTH: ["date of birth", "dates of birth"],
};

export function categoryLabel(cat: EntityCategory, count = 1): string {
  const [one, many] = CATEGORY_LABELS[cat] ?? [cat.toLowerCase(), cat.toLowerCase()];
  return count === 1 ? one : many;
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function roleLabel(role: string): string {
  return capitalize(role.toLowerCase().replace(/_/g, " "));
}

export interface LedgerCounts {
  hiddenTotal: number;
  hiddenByCategory: Array<{ category: EntityCategory; count: number; label: string }>;
  visibleTotal: number;
  pendingTotal: number;
}

/** Counts of items kept local (ACCEPTED = replaced with placeholders), kept visible (REJECTED) and undecided. */
export function ledgerCounts(entities: DetectedEntity[]): LedgerCounts {
  const byCat = new Map<EntityCategory, number>();
  let visibleTotal = 0;
  let pendingTotal = 0;
  let hiddenTotal = 0;
  for (const e of entities) {
    if (e.reviewStatus === "ACCEPTED") {
      hiddenTotal++;
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
    } else if (e.reviewStatus === "REJECTED") {
      visibleTotal++;
    } else {
      pendingTotal++;
    }
  }
  const hiddenByCategory = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count, label: `${count} ${categoryLabel(category, count)}` }));
  return { hiddenTotal, hiddenByCategory, visibleTotal, pendingTotal };
}

export interface PayloadSegment {
  text: string;
  placeholder: boolean;
}

/** Splits sanitized text so `[ORG_1]`-style placeholders can be highlighted (rendered via textContent only). */
export function splitPlaceholders(text: string): PayloadSegment[] {
  const out: PayloadSegment[] = [];
  const re = /\[[A-Z][A-Z0-9_]*\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), placeholder: false });
    out.push({ text: m[0], placeholder: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}

export function describePrivacyMode(mode: PrivacyMode): string {
  return mode === "HYBRID_ANONYMIZED"
    ? "Cleaned text goes to the deeper check only after you approve it"
    : "Nothing is sent anywhere";
}

export function severityLabel(s: ContractFinding["severity"]): string {
  return s === "HIGH" ? "High risk" : s === "MEDIUM" ? "Worth a look" : "Low risk";
}

export function findingSourceLabel(f: ContractFinding): { label: string; sent: boolean } {
  switch (f.analysisSource) {
    case "FIREBASE_AI_LOGIC_ONLY_IN_CLOUD":
      return { label: "Deeper check in the cloud, cleaned text only", sent: true };
    case "SIMULATED_CLOUD_SYNTHESIS":
      return { label: "Practice mode, ran on this device, nothing was sent", sent: false };
    case "FIREBASE_AI_LOGIC_ONLY_ON_DEVICE_TRIAGE":
      return { label: "Checked by private AI on this device", sent: false };
    default:
      return { label: "Checked on this device with built-in rules", sent: false };
  }
}

export function cleanFindingTitle(title: string): string {
  let t = title.replace(/^\s*\[[A-Z_]+\]\s*/, "");
  // Engine names are for Advanced settings, not for the person reading the result.
  t = t.replace(/\s*\((?:[^)]*(?:Firebase|ONLY_[A-Z_]+|Gemini|Nano|SDK)[^)]*)\)/gi, "");
  t = t.replace(/^\s*(?:Local|On-Device|On Device)\s+(?:Deterministic\s+|Gemini\s+Nano\s+)?(?:Clause\s+)?Triage\s*:?\s*/i, "");
  t = t.replace(/\b(?:Gemini\s+Nano|Firebase|Deterministic|Nano)\b\s*/gi, "").replace(/\bONLY_[A-Z_]+\b/g, "");
  t = t.replace(/\s{2,}/g, " ").replace(/^[\s:\-]+|[\s:\-]+$/g, "");
  return t || "Worth a closer look";
}

/** The toast shown after Continue hides details the person had not decided on. */
export function undecidedHiddenText(n: number): string {
  return `${n} undecided detail${n === 1 ? " was" : "s were"} hidden.`;
}

/** Feedback under the "Hide something we missed" form. */
export function manualAddFeedback(
  surface: string,
  places: number,
  categoryText: string
): { ok: boolean; text: string } {
  if (places === 0) {
    return { ok: false, text: `We couldn't find \u201c${surface}\u201d in the document. Check the spelling and capitalization.` };
  }
  return {
    ok: true,
    text: `Hidden in ${places} place${places === 1 ? "" : "s"}. Added to the list as ${categoryText}.`,
  };
}

/** One quiet line under the Results heading once the check is done. */
export function finishLede(hiddenCount: number, sentToCloud: boolean): string {
  const n = `${hiddenCount} detail${hiddenCount === 1 ? "" : "s"} kept private.`;
  return `${n} ${sentToCloud ? "Only the cleaned text was sent." : "Nothing personal was sent."}`;
}

/** Strip class names and error-code prefixes so people see a sentence, not a stack trace. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/^(?:\w*Error:\s*)+/, "").replace(/^\[?ERR_[A-Z_]+\]?:?\s*/, "").trim();
  if (/ERR_APP_CHECK|attestation/i.test(raw)) {
    return "The cloud service could not confirm this app is genuine, so nothing was sent. You can still use the on-device check.";
  }
  if (/stale|changed/i.test(raw)) {
    return "Something changed after you approved, so the result was thrown away. Please review and approve again.";
  }
  if (/Unexpected|Invalid PDF|password|corrupt/i.test(raw)) {
    return "We couldn't read that file. Try a different PDF, a Word (.docx) file or plain text.";
  }
  return msg || "Something went wrong. Nothing was sent.";
}

export type StepNumber = 1 | 2 | 3 | 4;

export function furthestStep(hasDocument: boolean, hasFindings: boolean): StepNumber {
  if (!hasDocument) return 1;
  return hasFindings ? 4 : 3;
}

export const STEP_TITLES: Record<StepNumber, string> = {
  1: "Start",
  2: "Review",
  3: "Approve",
  4: "Results",
};

/** Collapse technical runtime warnings into plain sentences (deduplicated). Unknown warnings pass through. */
export function plainWarnings(warnings: string[]): string[] {
  const out: string[] = [];
  let sawFallback = false;
  for (const w of warnings) {
    if (/LanguageModel|failing closed|ONLY_ON_DEVICE|weights|on-device model/i.test(w) && !/SUSPICIOUS/.test(w)) {
      if (!sawFallback) {
        out.push("Private AI wasn't available for this document, so built-in rules found the sensitive details. Please double-check the list in Review, especially people's names.");
        sawFallback = true;
      }
      continue;
    }
    const m = w.match(/SUSPICIOUS_ZERO_DETECTION on Chunk (\d+)/);
    if (m) {
      out.push(`Nothing was found in part ${m[1]} of the document. Please read it yourself and hide anything private.`);
      continue;
    }
    out.push(w);
  }
  return Array.from(new Set(out));
}

/**
 * Review rows: one row per category + exact text (case-insensitive), so a name or number that
 * appears five times is one decision, not five. Groups keep document order of first appearance.
 */
export function groupForReview(entities: DetectedEntity[]): Map<EntityCategory, DetectedEntity[][]> {
  const byCat = new Map<EntityCategory, Map<string, DetectedEntity[]>>();
  for (const e of entities) {
    const rows = byCat.get(e.category) ?? new Map<string, DetectedEntity[]>();
    const key = e.surface.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
    const row = rows.get(key) ?? [];
    row.push(e);
    rows.set(key, row);
    byCat.set(e.category, rows);
  }
  const out = new Map<EntityCategory, DetectedEntity[][]>();
  for (const [cat, rows] of byCat) out.set(cat, [...rows.values()]);
  return out;
}

function isPending(e: DetectedEntity): boolean {
  return e.reviewStatus === "PENDING_REVIEW" || e.reviewStatus === "NEEDS_DECISION";
}

/** Counts over review rows (unique items), matching what the Review list shows. */
export function reviewCounts(entities: DetectedEntity[]): {
  found: number;
  pending: number;
  hidden: number;
  visible: number;
} {
  let found = 0;
  let pending = 0;
  let hidden = 0;
  let visible = 0;
  for (const rows of groupForReview(entities).values()) {
    for (const row of rows) {
      found++;
      if (row.some(isPending)) pending++;
      else if (row.every((e) => e.reviewStatus === "ACCEPTED")) hidden++;
      else visible++;
    }
  }
  return { found, pending, hidden, visible };
}

/**
 * How an item was found, for the review row. The on-device model's self-reported confidence is
 * not calibrated (it often reports 0 for real names), so its suggestions are labelled as such
 * instead of showing a percentage.
 */
export function detectionNote(row: DetectedEntity[]): string {
  if (row.some((e) => e.source === "HUMAN_ADDED")) return "added by you";
  const labelled = row.find((e) => e.fieldLabel);
  if (labelled) return `next to the label "${labelled.fieldLabel}"`;
  if (row.every((e) => e.source === "NANO_ON_DEVICE")) return "suggested by on-device AI";
  const ent = row[0];
  if (row.some((e) => e.source === "WORKSPACE_GRAPH")) return "seen in your earlier documents";
  if (row.every((e) => e.source === "TRIGRAM_FUZZY")) return "close match to a name you saved before";
  // A plain reason instead of a model percentage: "0% sure" reads as broken to non-experts.
  return `looks like ${withArticle(categoryLabel(ent.category))}`;
}

function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** Review heading for a category, using the document profile's wording when it has one. */
export function reviewHeading(
  cat: EntityCategory,
  count: number,
  profileHeadings: Partial<Record<EntityCategory, [string, string]>> = {}
): string {
  const custom = profileHeadings[cat];
  const text = custom ? (count === 1 ? custom[0] : custom[1]) : categoryLabel(cat, count);
  return capitalize(text);
}

/** Categories the Review bar's "Hide all numbers and IDs" action covers. */
export const NUMBER_CATEGORIES: ReadonlySet<EntityCategory> = new Set<EntityCategory>([
  "PHONE", "IBAN", "CREDIT_CARD", "SSN", "EIN", "API_KEY", "ID_NUMBER", "DATE_OF_BIRTH",
]);

/**
 * Ids of the items a bulk "hide" action would change: entities in the given categories (all
 * categories when omitted) that are not already hidden.
 */
export function idsToHide(entities: DetectedEntity[], categories?: ReadonlySet<EntityCategory>): string[] {
  return entities
    .filter((e) => e.reviewStatus !== "ACCEPTED" && (!categories || categories.has(e.category)))
    .map((e) => e.id);
}

/**
 * The one short sentence spoken after a Review change: the outcome, then what is left.
 * Announces results, never activity ("Updating…").
 */
export function reviewAnnouncement(outcome: string, pendingRows: number): string {
  const left =
    pendingRows === 0
      ? "Every item has a choice now."
      : `${pendingRows} left to decide.`;
  return `${outcome}. ${left}`;
}

/** Why Continue on Review cannot move on yet, or null when it can. */
export function reviewContinueBlocker(pendingRows: number): string | null {
  if (pendingRows === 0) return null;
  return `${pendingRows} detail${pendingRows === 1 ? " still needs" : "s still need"} a choice. Hide ${pendingRows === 1 ? "it" : "them"} and continue, or go back to choose.`;
}

/** Spoken (polite) updates during the model download: start, halfway, done. At most 3 per download. */
export function downloadAnnouncement(
  prevPct: number | null,
  pct: number | null,
  state: NanoReadinessState
): string | null {
  if (state === "READY_ON_DEVICE") return prevPct !== null ? "Private AI is ready" : null;
  if (state !== "DOWNLOADING") return null;
  if (pct === null) return null;
  if (prevPct === null) return "Downloading private AI.";
  if (prevPct < 50 && pct >= 50) return "Private AI download is halfway.";
  return null;
}

/** Warning line on Review when built-in rules did the finding. */
export function fallbackReviewWarning(state: NanoReadinessState): string | null {
  switch (state) {
    case "DOWNLOADABLE_PENDING_WEIGHTS":
    case "UNAVAILABLE":
    case "DISABLED":
    case "DEGRADED_DETERMINISTIC_SAFE":
      return "Found with built-in rules. Names may be missed. Download private AI for a better check.";
    case "OFFLINE":
    case "ERROR":
      return "Found with built-in rules. Names may be missed.";
    default:
      return null;
  }
}

/** First 8 hex chars of the payload SHA-256 as XXXX-XXXX, or null when there is none. */
export function approvalId(sha256Hex: string | null | undefined): string | null {
  if (!sha256Hex || sha256Hex === "NONE") return null;
  const h = sha256Hex.trim();
  if (!/^[0-9a-fA-F]{8,}/.test(h)) return null;
  const u = h.slice(0, 8).toUpperCase();
  return `${u.slice(0, 4)}-${u.slice(4)}`;
}

export type WhereChecked = "Checked in the cloud" | "Checked on this device" | "Practice run";

export function whereCheckedLabel(source: string | null | undefined): WhereChecked {
  switch (source) {
    case "in_cloud":
    case "FIREBASE_AI_LOGIC_ONLY_IN_CLOUD":
      return "Checked in the cloud";
    case "SIMULATED_CLOUD_SYNTHESIS":
      return "Practice run";
    default:
      return "Checked on this device";
  }
}

export function practiceRunCard(
  hasLiveCloudConfig: boolean,
  simulationAllowed: boolean
): { title: string; sub: string; badge: string | null } {
  if (hasLiveCloudConfig) {
    return {
      title: "Send the cleaned text for a deeper check",
      sub: "Only the text on the left is sent. Your names and numbers are not.",
      badge: null,
    };
  }
  if (simulationAllowed) {
    return { title: "Practice run", sub: "A labelled local stand-in. Nothing is sent. Cloud is not set up.", badge: "Practice" };
  }
  return {
    title: "Deeper check is not set up",
    sub: "Cloud is not connected, so only the on-device check is available.",
    badge: null,
  };
}

export const FILE_LIMITS_TEXT =
  "PDF up to 50 pages, Word or text. Up to 25 MB. Scanned PDFs (photos of pages) cannot be read yet.";

export function occurrenceLabel(n: number): string {
  return n === 1 ? "appears 1 time" : `appears ${n} times`;
}

/** Visible role tag for a contract role; null for the generic or unknown role. */
export function roleTag(role: string | null | undefined): string | null {
  if (!role || role === "PARTY") return null;
  return roleLabel(role);
}

/** The privacy shield in the app bar: how much of the Review list has a decision. */
export function shieldProgress(decided: number, total: number): {
  pct: number;
  label: string;
  shortLabel: string;
  ariaLabel: string;
  complete: boolean;
} {
  const t = Math.max(0, Math.floor(total));
  const d = Math.min(t, Math.max(0, Math.floor(decided)));
  const complete = t > 0 && d === t;
  const pct = t === 0 ? 0 : Math.round((d / t) * 100);
  return {
    pct,
    complete,
    label: complete ? "All decided" : `${d} of ${t} decided`,
    shortLabel: complete ? "All decided" : `${d}/${t}`,
    ariaLabel: complete ? "All details decided" : `${d} of ${t} details decided`,
  };
}

/**
 * Plain words for a finding. The built-in on-device checks carry engine wording in their title and
 * rationale; people see what it means for them instead. Other findings keep their own message.
 */
export function plainFinding(f: ContractFinding): { title: string; message: string } {
  if (f.findingId === "LOCAL-TRIAGE-DET-1") {
    return f.severity === "HIGH"
      ? {
          title: "A limit on what they must pay may not hold",
          message:
            "This part talks about unlimited costs or things left out of a limit. Check whether a cap on what one side pays really applies, or whether another clause cancels it.",
        }
      : {
          title: "Nothing unusual stood out",
          message: "The part we checked looks like a standard clause. It is still worth reading the whole document yourself.",
        };
  }
  let message = (f.rationale || f.rehydratedExcerpt || f.anonymizedExcerpt || "").trim();
  message = message
    .replace(/^\s*Nano weights unavailable locally;\s*/i, "")
    .replace(/\s*with 0 outbound network requests/i, "")
    .replace(/\bdeterministic\s+/gi, "");
  if (message) message = message.charAt(0).toUpperCase() + message.slice(1);
  return { title: cleanFindingTitle(f.title), message };
}

/** The small "where it was checked" line under a finding, without internal clause labels. */
export function findingFootText(f: ContractFinding): string {
  const refs = f.clauseRefs.filter((r) => !/^Selected Local Clause$/i.test(r));
  return `${findingSourceLabel(f).label}${refs.length ? ` · ${refs.join(", ")}` : ""}`;
}
