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
}

export function describeDeviceAi(state: NanoReadinessState, progressPct: number | null): DeviceAiStatus {
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

export function describeCloud(t: ObservedFirebaseTelemetry): { tone: Tone; headline: string } {
  return t.hasLiveCloudConfig
    ? { tone: "ok", headline: "Deeper check: cloud connected and protected" }
    : { tone: "neutral", headline: "Deeper check: practice mode — runs on this device, nothing is sent" };
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
      return { label: "Deeper check in the cloud — cleaned text only", sent: true };
    case "SIMULATED_CLOUD_SYNTHESIS":
      return { label: "Practice mode — ran on this device, nothing was sent", sent: false };
    case "FIREBASE_AI_LOGIC_ONLY_ON_DEVICE_TRIAGE":
      return { label: "Checked by private AI on this device", sent: false };
    default:
      return { label: "Checked on this device with built-in rules", sent: false };
  }
}

export function cleanFindingTitle(title: string): string {
  return title.replace(/^\s*\[[A-Z_]+\]\s*/, "").trim() || "Finding";
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
  1: "Import",
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
  if (labelled) return `next to "${labelled.fieldLabel}"`;
  const best = row.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  if (row.every((e) => e.source === "NANO_ON_DEVICE")) return "suggested by on-device AI";
  return `${Math.round(best.confidence * 100)}% sure`;
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
