/**
 * Friendly sample documents for the Import step. All content is synthetic.
 * The three original contract samples come from the core controller (ids unchanged so existing
 * automation keeps working); the lease and medical bill are UI-level samples.
 */
import { SYNTHETIC_SAMPLE_CONTRACTS } from "../core/sessionController.ts";

export interface UiSample {
  id: string;
  title: string;
  blurb: string;
  fileName: string;
  text: string;
  audience: "everyone" | "professional";
}

const TENANT_LEASE =
  "RESIDENTIAL LEASE AGREEMENT dated 2026-09-01 between Hartwell Property Holdings LLC, the landlord, and Maya Okafor, the tenant, " +
  "for the apartment at Lindenstrasse 48, 10115 Berlin, Germany. Tenant contact: maya.okafor@example.com, +49-30-555-0142. " +
  "Clause 3.1 Rent: monthly rent is USD $2,450.00, due on the 1st of each month; a security deposit of USD $7,350.00 is due at signing. " +
  "Clause 6.2 Deposit Return: the Landlord may keep any part of the deposit for 'cleaning and general wear' without an itemized list. " +
  "Clause 8.4 Early Termination: if the Tenant leaves early the full deposit is forfeited and the Tenant also owes USD $4,900.00. " +
  "Clause 11.1 Entry: the Landlord may enter the apartment at any time without notice. " +
  "Clause 12.3 Renewal: the lease renews automatically for 12 months unless the Tenant gives written notice 90 days before the end date. " +
  "Rent is paid to IBAN DE89370400440532013000.";

const MEDICAL_BILL =
  "ITEMIZED HOSPITAL STATEMENT from Riverbend Regional Medical Center to patient Jordan Ellis. " +
  "Patient phone (415) 555-0178, email jordan.ellis@example.com, home address Gartenstrasse 5, 80331 Munich, Germany. " +
  "Patient ID 999-01-4242. Date of service 2026-07-14, emergency visit. " +
  "Line 1: CPT 99285 Emergency department visit, high severity, $2,180.00. " +
  "Line 2: CPT 99285 Emergency department visit, high severity, $2,180.00. " +
  "Line 3: CPT 71046 Chest X-ray, 2 views, $1,240.00. " +
  "Line 4: Facility fee, out-of-network surcharge, $3,420.00. " +
  "Insurance adjustment: -$1,100.00. Patient balance due: $7,920.00 within 30 days or the account moves to collections. " +
  "Pay by card or to IBAN DE89370400440532013000.";

const ORIGINAL_BLURBS: Record<string, { title: string; blurb: string }> = {
  "sample-msa-trap": {
    title: "Business services agreement",
    blurb: "A liability cap that a later clause quietly cancels out.",
  },
  "sample-dpa-collision": {
    title: "Data processing addendum",
    blurb: "Similar company names and roles that flip between parties.",
  },
  "sample-adversarial-injection": {
    title: "Tricky NDA (hidden text test)",
    blurb: "Hidden characters and instructions aimed at the AI. Safe to try.",
  },
};

export function buildSamples(): UiSample[] {
  const everyday: UiSample[] = [
    {
      id: "sample-tenant-lease",
      title: "Apartment lease",
      blurb: "For tenants: deposit, early exit, entry and auto-renewal clauses.",
      fileName: "apartment_lease_synthetic.txt",
      text: TENANT_LEASE,
      audience: "everyone",
    },
    {
      id: "sample-medical-bill",
      title: "Hospital bill",
      blurb: "For patients: a duplicate charge, a surprise fee and a collections deadline.",
      fileName: "hospital_bill_synthetic.txt",
      text: MEDICAL_BILL,
      audience: "everyone",
    },
  ];
  const pro: UiSample[] = SYNTHETIC_SAMPLE_CONTRACTS.map((c) => ({
    id: c.id,
    title: ORIGINAL_BLURBS[c.id]?.title ?? c.label,
    blurb: ORIGINAL_BLURBS[c.id]?.blurb ?? "Synthetic contract sample.",
    fileName: c.fileName,
    text: c.text,
    audience: "professional",
  }));
  return [...everyday, ...pro];
}
