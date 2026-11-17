import type { ContractRole, DetectedEntity, EntityCategory } from "../types.ts";

/** Hard legal-operator shield preventing over-redaction of liability logic or jurisdictions. */
export const LEGAL_OPERATOR_SHIELD = new Set<string>([
  "not",
  "excluding",
  "except",
  "unlimited",
  "aggregate",
  "liability",
  "indemnification",
  "confidentiality",
  "annual fees",
  "state of delaware",
  "delaware",
  "california",
  "new york",
  "monthly performance review",
]);

/** Luhn checksum validator for credit/payment card numbers. */
export function passesLuhn(digitsOnly: string): boolean {
  if (!/^\d{13,19}$/.test(digitsOnly)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let n = digitsOnly.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** ISO 13616 Mod-97 IBAN checksum validator. */
export function passesIbanMod97(rawIban: string): boolean {
  const clean = rawIban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const ch = rearranged.charCodeAt(i);
    const expanded = ch >= 65 && ch <= 90 ? String(ch - 55) : rearranged[i];
    for (let j = 0; j < expanded.length; j++) {
      remainder = (remainder * 10 + (expanded.charCodeAt(j) - 48)) % 97;
    }
  }
  return remainder === 1;
}

function makeEntity(
  idx: number,
  surface: string,
  category: EntityCategory,
  normStart: number,
  normEnd: number,
  rationale: string,
  confidence = 0.99,
  role: ContractRole = "PARTY"
): DetectedEntity {
  return {
    id: `L1-${category}-${idx}`,
    surface,
    canonicalKey: `${category}:${surface.toLowerCase().replace(/\s+/g, "_")}`,
    canonicalName: surface,
    category,
    role,
    normStart,
    normEnd,
    source: "DETERMINISTIC_L1",
    confidence,
    rationale,
    reviewStatus: "ACCEPTED",
  };
}

export interface DetectorOptions {
  allowSyntheticCanarySsn?: boolean;
}

/**
 * Execute linear-time deterministic Layer-1 pattern & checksum detection.
 * Guarded against ReDoS by avoiding nested unbounded quantifiers.
 */
export function runDeterministicDetectors(
  normalizedText: string,
  opts: DetectorOptions = {}
): DetectedEntity[] {
  const results: DetectedEntity[] = [];
  let seq = 1;

  // 1. Emails (linear regex)
  const emailRe = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,12}\b/g;
  for (const m of normalizedText.matchAll(emailRe)) {
    const s = m.index ?? 0;
    results.push(makeEntity(seq++, m[0], "EMAIL", s, s + m[0].length, "RFC-5322 email pattern"));
  }

  // 2. High-entropy API keys / bearer tokens
  const keyRe = /\b(?:sk-[A-Za-z0-9_-]{16,80}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{20,60})\b/g;
  for (const m of normalizedText.matchAll(keyRe)) {
    const s = m.index ?? 0;
    results.push(makeEntity(seq++, m[0], "API_KEY", s, s + m[0].length, "Known API credential prefix + high entropy"));
  }

  // 3. IBAN (Mod-97 checksum verified)
  const ibanRe = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
  for (const m of normalizedText.matchAll(ibanRe)) {
    if (passesIbanMod97(m[0])) {
      const s = m.index ?? 0;
      results.push(makeEntity(seq++, m[0], "IBAN", s, s + m[0].length, "ISO-13616 Mod-97 checksum verified", 1.0, "BANK"));
    }
  }

  // 4. Credit/Payment Card numbers (linear digit-space prefilter + Luhn check)
  const cardRe = /(?<!\d)\d[\d -]{11,22}\d(?!\d)/g;
  for (const m of normalizedText.matchAll(cardRe)) {
    const digits = m[0].replace(/[\s-]/g, "");
    if (passesLuhn(digits)) {
      const s = m.index ?? 0;
      results.push(makeEntity(seq++, m[0], "CREDIT_CARD", s, s + m[0].length, "Luhn checksum verified", 0.98, "BANK"));
    }
  }

  // 5. SSN (supports synthetic 999-xx canary mode when explicitly enabled)
  const ssnRe = /\b(\d{3})-(\d{2})-(\d{4})\b/g;
  for (const m of normalizedText.matchAll(ssnRe)) {
    const area = Number(m[1]);
    const isSynthetic = area === 999 || area === 900;
    const validReal = area !== 0 && area !== 666 && area < 900;
    if (validReal || (opts.allowSyntheticCanarySsn !== false && isSynthetic)) {
      const s = m.index ?? 0;
      results.push(
        makeEntity(
          seq++,
          m[0],
          "SSN",
          s,
          s + m[0].length,
          isSynthetic ? "Synthetic canary SSN pattern" : "US SSN format match",
          0.95
        )
      );
    }
  }

  // 6. US EIN (contextual anchor or standard XX-XXXXXXX)
  const einRe = /\b(?:EIN|Tax ID)[:\s#]*(\d{2}-\d{7})\b/gi;
  for (const m of normalizedText.matchAll(einRe)) {
    const val = m[1];
    const start = (m.index ?? 0) + m[0].indexOf(val);
    results.push(makeEntity(seq++, val, "EIN", start, start + val.length, "Context-anchored Employer ID"));
  }

  // 7. Phone numbers (US + international E.164 like +49-89-555-0199)
  const phoneRe = /(?:\+\d{1,3}[\s.-]?\d{2,4}[\s.-]\d{3,4}[\s.-]\d{4}|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})\b/g;
  for (const m of normalizedText.matchAll(phoneRe)) {
    const s = m.index ?? 0;
    results.push(makeEntity(seq++, m[0], "PHONE", s, s + m[0].length, "Phone number pattern", 0.92));
  }

  // 7b. Street / postal addresses (linear-time pattern for European/US corporate addresses)
  const addrRe = /\b[A-Z][A-Za-z0-9.\-]{2,32}(?:strasse|straße|Street|St\.|Avenue|Ave\.|Boulevard|Blvd\.|Road|Rd\.|Way|Drive|Dr\.)\s+\d{1,5}(?:,\s*\d{4,6}\s+[A-Z][A-Za-z.\- ]{2,28}(?:,\s*[A-Z][A-Za-z.\- ]{2,24})?)?/g;
  for (const m of normalizedText.matchAll(addrRe)) {
    const s = m.index ?? 0;
    results.push(makeEntity(seq++, m[0], "ADDRESS", s, s + m[0].length, "Corporate street/postal address pattern", 0.91));
  }

  // 8. Large explicit currency caps (never mask multipliers like 1.5x!)
  const currRe = /(?:USD\s*\$|\$|EUR\s*€|€)\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/g;
  for (const m of normalizedText.matchAll(currRe)) {
    const s = m.index ?? 0;
    results.push(
      makeEntity(
        seq++,
        m[0],
        "CURRENCY_CAP",
        s,
        s + m[0].length,
        "Explicit currency amount (magnitude-banded on redaction)",
        0.96
      )
    );
  }

  // 9. Project / Operation Codenames
  const codeRe = /\b(?:Project|Operation)\s+[A-Z][A-Za-z0-9_-]{2,24}\b/g;
  for (const m of normalizedText.matchAll(codeRe)) {
    if (!LEGAL_OPERATOR_SHIELD.has(m[0].toLowerCase())) {
      const s = m.index ?? 0;
      results.push(makeEntity(seq++, m[0], "CODENAME", s, s + m[0].length, "Proprietary project/operation codename", 0.95));
    }
  }

  return results;
}
