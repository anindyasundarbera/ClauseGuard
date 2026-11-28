import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { PrivacyProcessingAndEgressReport16 } from "../../src/core/types.ts";
import { buildPrivacyReportPdf, pdfFileName, toWinAnsi, verdictText } from "../../src/ui/reportPdf.ts";

const base = {
  report_id: "CG-1",
  generated_at_utc: "2026-11-28T13:14:00Z",
  session_id: "s1",
  privacy_mode: "LOCAL_ONLY",
  nano_readiness_state: "READY",
  raw_document_sha256: "a".repeat(64),
  normalized_document_sha256: "b".repeat(64),
  approved_payload_sha256: null,
  redaction_map_version: 4,
  entities_accepted_count: 1,
  entities_rejected_count: 0,
  local_inference_source: "DETERMINISTIC_LOCAL_TRIAGE",
  cloud_inference_source: null,
  verified_properties: ["Raw text stayed local"],
  unverified_external_properties: ["Browser add-ons"],
  known_limitations_and_non_certification_disclaimer: "Not a certificate.",
} as unknown as PrivacyProcessingAndEgressReport16;

const opts = {
  hiddenItems: [{ label: "People's names", count: 2 }],
  hiddenTotal: 2,
  sentCount: 0,
  findings: [{ severity: "HIGH" as const, title: "A limit — may not hold", message: "Check “the cap”." }],
  documentTitle: "Master services agreement",
};

describe("report pdf", () => {
  it("builds a multi-page PDF", async () => {
    const bytes = await buildPrivacyReportPdf(base, opts);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
  });
  it("handles empty lists", async () => {
    const bytes = await buildPrivacyReportPdf(base, { ...opts, hiddenItems: [], findings: [] });
    expect(bytes.length).toBeGreaterThan(500);
  });
  it("toWinAnsi replaces and strips", () => {
    expect(toWinAnsi("“hi” — it’s… ok")).toBe('"hi" - it\'s... ok');
    expect(() => toWinAnsi("😀 नमस्ते")).not.toThrow();
    expect(toWinAnsi("a😀b नमस्ते")).toBe("ab ");
  });
  it("40 findings add pages", async () => {
    const findings = Array.from({ length: 40 }, (_, i) => ({
      severity: (["HIGH", "MEDIUM", "LOW"] as const)[i % 3],
      title: `Finding ${i} 😀`,
      message: "Some plain message that is long enough to wrap onto more than one line in the report. ".repeat(3),
    }));
    const bytes = await buildPrivacyReportPdf(base, { ...opts, findings });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
  });
  it("verdict differs for cloud", () => {
    const cloud = { ...base, privacy_mode: "HYBRID_ANONYMIZED", cloud_inference_source: "X" } as unknown as PrivacyProcessingAndEgressReport16;
    expect(verdictText(base)).toBe("Checked on this device. Nothing personal was sent.");
    expect(verdictText(cloud)).toBe("Only the cleaned text you approved was sent for a deeper check.");
  });
  it("file name", () => expect(pdfFileName("abc")).toBe("clauseguard-privacy-report-abc.pdf"));
});
