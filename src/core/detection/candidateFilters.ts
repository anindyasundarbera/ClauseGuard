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
