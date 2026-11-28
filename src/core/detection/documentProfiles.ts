import type { DetectedEntity, EntityCategory } from "../types.ts";
import { NAME_TAIL_LABELS } from "./candidateFilters.ts";

/**
 * Document profiles.
 *
 * ClauseGuard first works out what kind of document it is reading (a contract, a medical report,
 * a bill, a bank statement), entirely on this device, from cue words. The profile then decides:
 *   - the review headings ("Patients and doctors" in a medical report, "People and signatories"
 *     in a contract),
 *   - which kinds of suggestion the on-device AI may make (no "project names" in a lab report),
 *   - a one-line hint added to the on-device AI prompt.
 *
 * Separately, label-anchored field patterns ("Patient Name : …", "UHID : …", "DOB : …",
 * "Mobile No : …") run on every document. A value printed next to a known label is far more
 * reliable than any guess, so these patterns carry most of the detection on forms and reports.
 */

export type DocumentKind = "CONTRACT" | "MEDICAL" | "BILL" | "FINANCIAL" | "GENERAL";

export interface DocumentProfile {
  kind: DocumentKind;
  /** Plain name shown to the person, e.g. "medical report". */
  label: string;
  /** Review headings per category: [one, many]. Missing categories use the default labels. */
  headings: Partial<Record<EntityCategory, [string, string]>>;
  /** Categories the on-device AI is allowed to suggest for this kind of document. */
  modelCategories: ReadonlySet<EntityCategory>;
  /** Extra guidance appended to the on-device AI prompt. */
  promptHint: string;
}

export interface DocumentClassification {
  profile: DocumentProfile;
  /** Cue words that decided it, for "Under the hood". */
  cues: string[];
}

const ALL_MODEL_CATEGORIES: ReadonlySet<EntityCategory> = new Set(["PERSON", "ORG", "ADDRESS", "CODENAME"]);
const NO_CODENAMES: ReadonlySet<EntityCategory> = new Set(["PERSON", "ORG", "ADDRESS"]);

export const DOCUMENT_PROFILES: Record<DocumentKind, DocumentProfile> = {
  CONTRACT: {
    kind: "CONTRACT",
    label: "contract or agreement",
    headings: {
      PERSON: ["person or signatory", "people and signatories"],
      ORG: ["party or company", "parties and companies"],
      ID_NUMBER: ["reference number", "reference numbers"],
    },
    modelCategories: ALL_MODEL_CATEGORIES,
    promptHint: "This is a contract. Parties, signatories, addresses and project codenames matter.",
  },
  MEDICAL: {
    kind: "MEDICAL",
    label: "medical report",
    headings: {
      PERSON: ["patient, doctor or relative", "patients, doctors and relatives"],
      ORG: ["hospital, clinic or insurer", "hospitals, clinics and insurers"],
      ID_NUMBER: ["patient or record number", "patient and record numbers"],
      ADDRESS: ["address", "addresses"],
      PHONE: ["phone number", "phone numbers"],
    },
    modelCategories: NO_CODENAMES,
    promptHint:
      "This is a medical document. Return only names of patients, doctors and relatives, hospital or clinic names, and postal addresses. Test names, results, diagnoses, procedures, drugs and dates are not private names.",
  },
  BILL: {
    kind: "BILL",
    label: "bill or invoice",
    headings: {
      PERSON: ["billed person", "billed people"],
      ORG: ["company or provider", "companies and providers"],
      ID_NUMBER: ["invoice, account or policy number", "invoice, account and policy numbers"],
    },
    modelCategories: NO_CODENAMES,
    promptHint: "This is a bill or invoice. Item names, quantities, rates and totals are not private names.",
  },
  FINANCIAL: {
    kind: "FINANCIAL",
    label: "bank or account statement",
    headings: {
      PERSON: ["account holder or payee", "account holders and payees"],
      ORG: ["bank, merchant or company", "banks, merchants and companies"],
      ID_NUMBER: ["account or reference number", "account and reference numbers"],
    },
    modelCategories: NO_CODENAMES,
    promptHint: "This is a bank or account statement. Transaction codes and balances are not private names.",
  },
  GENERAL: {
    kind: "GENERAL",
    label: "document",
    headings: {},
    modelCategories: NO_CODENAMES,
    promptHint: "",
  },
};

const CUES: Record<Exclude<DocumentKind, "GENERAL">, RegExp[]> = {
  CONTRACT: [
    /\bagreement\b/i,
    /\bparties\b/i,
    /\bhereinafter\b/i,
    /\bwhereas\b/i,
    /\bclause\s+\d/i,
    /\bgoverning law\b/i,
    /\bindemnif/i,
    /\bliabilit(?:y|ies)\b/i,
    /\btermination\b/i,
    /\bconfidential(?:ity)?\b/i,
    /\blandlord\b/i,
    /\btenant\b/i,
    /\bin witness whereof\b/i,
    /\bshall\b/i,
  ],
  MEDICAL: [
    /\bpatient\b/i,
    /\buhid\b/i,
    /\bmrn\b/i,
    /\bdiagnos[ie]s\b/i,
    /\bconsultant\b/i,
    /\bhospital\b/i,
    /\bclinic\b/i,
    /\ban(?:a)?esthe(?:sia|tic|tist)\b/i,
    /\bsurgery|surgical|operation theatre\b/i,
    /\bprescri(?:ption|bed)\b/i,
    /\bha?emoglobin\b/i,
    /\b(?:ecg|echo|x-?ray|mri|ct scan)\b/i,
    /\bward\b/i,
    /\badmission|discharge\b/i,
    /\b(?:opd|ipd)\b/i,
    /\bpathology|radiology\b/i,
    /\bblood\b/i,
    /\bmg\b/i,
  ],
  BILL: [
    /\binvoice\b/i,
    /\bbill(?:ed|ing)?\b/i,
    /\bamount due\b/i,
    /\bsub-?total\b/i,
    /\bgrand total\b/i,
    /\b(?:gst|vat|tax)\b/i,
    /\bpayment due\b/i,
    /\breceipt\b/i,
    /\bqty\b/i,
    /\bcharges\b/i,
  ],
  FINANCIAL: [
    /\baccount statement|statement of account\b/i,
    /\bifsc\b/i,
    /\bopening balance\b/i,
    /\bclosing balance\b/i,
    /\btransaction\b/i,
    /\bdebit\b/i,
    /\bcredit\b/i,
    /\bbranch\b/i,
    /\bstatement period\b/i,
    /\bwithdrawal|deposit\b/i,
  ],
};

/** Work out what kind of document this is from cue words. Needs at least 3 distinct cues. */
export function classifyDocument(text: string): DocumentClassification {
  const sample = text.slice(0, 20000);
  let best: { kind: DocumentKind; cues: string[] } = { kind: "GENERAL", cues: [] };
  for (const [kind, patterns] of Object.entries(CUES) as Array<[DocumentKind, RegExp[]]>) {
    const cues: string[] = [];
    for (const rx of patterns) {
      const m = sample.match(rx);
      if (m) cues.push(m[0].toLowerCase());
    }
    if (cues.length > best.cues.length) best = { kind, cues };
  }
  if (best.cues.length < 3) return { profile: DOCUMENT_PROFILES.GENERAL, cues: best.cues };
  return { profile: DOCUMENT_PROFILES[best.kind], cues: best.cues };
}

/* ------------------------------------------------------------------------------------------ */
/* Label-anchored field patterns                                                               */
/* ------------------------------------------------------------------------------------------ */

interface FieldRule {
  category: EntityCategory;
  /** Label alternatives, as regex source, matched case-insensitively at a word boundary. */
  labels: string[];
  /** Pull the value out of the text that follows the label, or return null. */
  value: (rest: string) => string | null;
}

const HONORIFIC_RE = "(?:Dr|Mr|Mrs|Ms|Miss|Prof|Shri|Smt|Sri|Kumari|Master|Baby|B\\/O)\\.?";

/**
 * Addresses are often printed over several lines. Keep following lines while they read like
 * more of the address: the line so far ends with a comma, or the next line has a comma or a
 * postcode and no "Label :". Stops after a line that ends with a postcode, and after 3 lines.
 */
function addressWithContinuation(rest: string): string {
  const lines = rest.split("\n");
  let out = lines[0].split("\t")[0];
  for (let i = 1; i < lines.length && i <= 3; i++) {
    if (/(?<!\d)\d{5,6}\s*$/.test(out)) break;
    const next = lines[i].split("\t")[0];
    if (!next.trim() || /(?<!\d)\s?:(?!\d)/.test(next)) break;
    const continues =
      /,\s*$/.test(out) || (/,/.test(next) && next.length <= 80) || /^\s*[-–]?\s*\d{5,6}\b/.test(next);
    if (!continues) break;
    out += "\n" + next;
    if (lines[i].includes("\t")) break;
  }
  return out;
}

/** Up to 6 name words; honorific optional; stops at the first non-name word. */
function personValue(rest: string): string | null {
  const m = rest.match(new RegExp(`^(?:${HONORIFIC_RE}\\s+)?\\p{L}[\\p{L}'’.-]*(?:[ ]+\\p{L}[\\p{L}'’.-]*){0,5}`, "u"));
  if (!m) return null;
  const words = m[0].split(/\s+/);
  // Drop trailing form labels ("Gender", "Age") that sit on the same line.
  while (words.length > 1 && NAME_TAIL_LABELS.has(words[words.length - 1].replace(/[.,]+$/, "").toLowerCase())) {
    words.pop();
  }
  const nameWords = words.filter((w) => !new RegExp(`^${HONORIFIC_RE}$`, "i").test(w));
  if (nameWords.length === 0) return null;
  if (nameWords.some((w) => NAME_TAIL_LABELS.has(w.toLowerCase()))) return null;
  if (nameWords.join("").replace(/[^\p{L}]/gu, "").length < 3) return null;
  // Keep a final initial's dot ("Ravi K."), drop any other trailing punctuation.
  const joined = words.join(" ");
  return /\s\p{L}\.$/u.test(joined) ? joined : joined.replace(/[.,]+$/, "");
}

function idValue(rest: string): string | null {
  const m = rest.match(/^[A-Z0-9][A-Z0-9/-]{2,28}[A-Z0-9]/i);
  if (!m || !/\d{3,}/.test(m[0])) return null;
  return m[0];
}

function dateValue(rest: string): string | null {
  const m = rest.match(
    /^(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ -,]+\d{2,4})/i
  );
  return m ? m[0] : null;
}

function phoneValue(rest: string): string | null {
  const m = rest.match(/^\+?\d[\d -]{8,16}\d/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 ? m[0] : null;
}

function addressValue(rest: string): string | null {
  const v = rest.trimEnd().replace(/[,;]+$/, "").trimEnd();
  return (v.match(/\p{L}/gu) ?? []).length >= 8 && v.length <= 240 ? v : null;
}

function orgValue(rest: string): string | null {
  const m = rest.match(/^\p{L}[\p{L}\p{N}&'’.-]*(?:[ ]+[\p{L}\p{N}&'’.-]+){0,7}/u);
  if (!m) return null;
  const v = m[0].replace(/[.,]+$/, "");
  return (v.match(/\p{L}/gu) ?? []).length >= 3 ? v : null;
}

const FIELD_RULES: FieldRule[] = [
  {
    category: "PERSON",
    labels: [
      "Patient(?:'s)? Name",
      "Name of (?:the )?Patient",
      "Pt\\.? Name",
      "Patient",
      "Name",
      "Consultant(?: Name)?",
      "(?:Treating|Attending|Referring|Ref\\.?) (?:Doctor|Dr\\.?|Physician)",
      "Doctor(?:'s)?(?: Name)?",
      "Surgeon",
      "An(?:a)?esthe(?:tist|siologist)",
      "Referred By",
      "Ref\\.? By",
      "Guardian(?:'s)?(?: Name)?",
      "(?:Father|Mother|Husband|Wife|Spouse)(?:'s)? Name",
      "S/O|D/O|W/O|C/O",
      "Next of Kin",
      "Policy ?Holder",
      "Insured(?: Name)?",
      "Account Holder(?: Name)?",
      "Customer Name",
      "Bill(?:ed)? To",
      "Employee Name",
      "Signed By",
    ],
    value: personValue,
  },
  {
    category: "ID_NUMBER",
    labels: [
      "UHID(?: No\\.?)?",
      "MRN",
      "(?:IP|OP|IPD|OPD|CR|Lab|Hospital|Reg(?:istration)?) ?No\\.?",
      "Patient ID",
      "Sample ID",
      "Bill No\\.?",
      "Invoice No\\.?",
      "Receipt No\\.?",
      "Policy No\\.?",
      "Claim No\\.?",
      "Member ID",
      "Customer ID",
      "Employee ID",
      "Account No\\.?",
      "A/?c No\\.?",
      "Aadhaar(?: No\\.?)?",
      "PAN(?: No\\.?)?",
      "Ref(?:erence)? No\\.?",
    ],
    value: idValue,
  },
  { category: "DATE_OF_BIRTH", labels: ["D\\.?O\\.?B\\.?", "Date of Birth", "Birth Date"], value: dateValue },
  {
    // Combined labels such as "Gender/Age/Dob : Male , 72 Years , 15/01/54": the date of birth
    // is the date inside the value.
    category: "DATE_OF_BIRTH",
    labels: ["(?:(?:Gender|Sex|Age)\\s?/\\s?){1,2}D\\.?O\\.?B\\.?"],
    value: (rest) => {
      const m = rest.match(/(?<![\d/.-])\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?![\d/.-])/);
      return m ? m[0] : null;
    },
  },
  {
    category: "PHONE",
    labels: ["Mobile(?: No\\.?)?", "Mob\\.?(?: No\\.?)?", "Phone(?: No\\.?)?", "Ph\\.?(?: No\\.?)?", "Contact(?: No\\.?)?", "Tel\\.?"],
    value: phoneValue,
  },
  {
    category: "ADDRESS",
    labels: [
      "(?:Residential|Permanent|Present|Correspondence|Billing|Patient|Home) Address",
      "Address",
    ],
    value: addressValue,
  },
  {
    category: "ORG",
    labels: ["Hospital Name", "Insurance Company", "Insurer", "TPA(?: Name)?", "Employer", "Company Name"],
    value: orgValue,
  },
];

/** Words that make up form labels ("Age", "IP No", "Plan Type", "Mobile No"). */
const LABEL_WORDS = new Set<string>([
  ...NAME_TAIL_LABELS,
  "no", "no.", "number", "type", "years", "yrs", "time", "hours", "score", "status", "group", "blood",
  "weight", "height", "bmi", "ip", "op", "ipd", "opd", "cr", "lab", "sample", "mob", "mob.", "ph", "ph.",
  "contact", "d.o.b", "d.o.b.", "birth", "relation", "religion", "occupation", "nationality", "marital",
  "procedure", "surgery", "remarks", "visit", "report", "collected", "received", "reported", "by", "doctor",
  "dr", "dr.", "specimen", "hospital", "insurer", "tpa", "claim", "member", "customer", "employee",
  "account", "a/c", "aadhaar", "pan", "receipt", "amount", "total", "category", "class", "package",
]);

/**
 * Cut a value at the next "Label :" on the same line. The label is the run of label words just
 * before the colon ("... Pal Age : 58" cuts before "Age"); if none are known, one word is dropped.
 * A colon between digits (a time, "10:30") does not count.
 */
function cutAtNextLabel(rest: string): string {
  const colon = rest.search(/(?<!\d)\s?:(?!\d)/);
  if (colon < 0) return rest;
  const before = rest.slice(0, colon).trimEnd();
  const words = [...before.matchAll(/\S+/g)].map((m) => ({ w: m[0], s: m.index ?? 0 }));
  let keep = words.length;
  let removed = 0;
  while (keep > 0 && removed < 3 && LABEL_WORDS.has(words[keep - 1].w.toLowerCase())) {
    keep--;
    removed++;
  }
  if (removed === 0) keep = Math.max(0, keep - 1);
  return keep === 0 ? "" : before.slice(0, words[keep - 1].s + words[keep - 1].w.length);
}

const FIELD_REGEX = new RegExp(
  `(?<![\\p{L}])(${FIELD_RULES.map((r) => r.labels.map((l) => `(?:${l})`).join("|"))
    .map((g, i) => `(?<f${i}>${g})`)
    .join("|")})[ \\t]*(?::|-|–|#)[ \\t]*`,
  "giu"
);

/**
 * Find values printed next to known labels ("Patient Name : Mr X Age : 58" gives "Mr X").
 * The value ends at a line break, a tab (table cell), the next "Label :" or the rule's own shape.
 */
export function runFieldDetectors(text: string): DetectedEntity[] {
  const out: DetectedEntity[] = [];
  let seq = 1;
  for (const m of text.matchAll(FIELD_REGEX)) {
    const ruleIdx = FIELD_RULES.findIndex((_, i) => m.groups?.[`f${i}`] !== undefined);
    if (ruleIdx < 0) continue;
    const rule = FIELD_RULES[ruleIdx];
    const label = m.groups?.[`f${ruleIdx}`]?.trim() ?? "";
    const valueStart = (m.index ?? 0) + m[0].length;
    let rest = text.slice(valueStart, valueStart + 240);
    const lineEnd = rest.search(/[\n\t]/);
    if (lineEnd >= 0) {
      rest = rule.category === "ADDRESS" ? addressWithContinuation(rest) : rest.slice(0, lineEnd);
    }
    rest = cutAtNextLabel(rest);
    const value = rule.value(rest.trimEnd());
    if (!value) continue;
    const start = valueStart + rest.indexOf(value);
    if (start < valueStart) continue;
    out.push({
      id: `FIELD-${rule.category}-${seq++}`,
      surface: value,
      canonicalKey: `FIELD:${rule.category}:${value.toLowerCase().replace(/\s+/g, "_")}`,
      canonicalName: value,
      category: rule.category,
      role: rule.category === "PERSON" ? "SIGNATORY" : "PARTY",
      normStart: start,
      normEnd: start + value.length,
      source: "DETERMINISTIC_L1",
      confidence: 0.95,
      rationale: `Printed next to the label "${label}"`,
      fieldLabel: label,
      reviewStatus: "ACCEPTED",
    });
  }
  return out;
}

/** Find every other place a field value appears (a patient name repeated in the footer). */
export function expandFieldOccurrences(text: string, fields: DetectedEntity[]): DetectedEntity[] {
  const out: DetectedEntity[] = [];
  const seen = new Set(fields.map((f) => `${f.normStart}:${f.normEnd}`));
  let seq = 1;
  for (const f of fields) {
    if (f.surface.length < 5) continue;
    let from = 0;
    for (;;) {
      const idx = text.indexOf(f.surface, from);
      if (idx < 0) break;
      from = idx + f.surface.length;
      const before = idx === 0 ? "" : text[idx - 1];
      const after = text[idx + f.surface.length] ?? "";
      if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
      const key = `${idx}:${idx + f.surface.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...f, id: `${f.id}-R${seq++}`, normStart: idx, normEnd: idx + f.surface.length });
    }
  }
  return out;
}
