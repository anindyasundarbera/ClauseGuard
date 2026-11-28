import { describe, expect, it } from "vitest";
import { buildReadablePrivacyReport, escapeHtml } from "../../src/ui/reportHtml.ts";
import type { PrivacyProcessingAndEgressReport16 } from "../../src/core/types.ts";

const baseReport: PrivacyProcessingAndEgressReport16 = {
  report_id: "rep_123",
  generated_at_utc: "2026-11-28T10:15:00Z",
  session_id: "sess_abc",
  privacy_mode: "LOCAL_ONLY",
  nano_readiness_state: "READY_ON_DEVICE",
  raw_document_sha256: "a".repeat(64),
  normalized_document_sha256: "b".repeat(64),
  approved_payload_sha256: null,
  redaction_map_version: 1,
  entities_accepted_count: 3,
  entities_rejected_count: 0,
  local_inference_source: "on_device",
  cloud_inference_source: null,
  verified_properties: ["Hidden items were replaced before display."],
  unverified_external_properties: ["Cloud models were not used."],
  known_limitations_and_non_certification_disclaimer: "This report is not a certification.",
};

const hidden = [
  { label: "Jane Doe", category: "PERSON_NAME" },
  { label: "ACME Ltd", category: "ORG" },
];

describe("buildReadablePrivacyReport", () => {
  it("escapes script tags in hidden item labels", () => {
    const html = buildReadablePrivacyReport(baseReport, {
      hiddenItems: [{ label: "<script>alert(1)</script>", category: "ORG" }],
      findingsCount: 1,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<script/i);
  });

  it("escapeHtml escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("uses the local-only summary sentence when nothing went to the cloud", () => {
    const html = buildReadablePrivacyReport(baseReport, { hiddenItems: hidden, findingsCount: 3 });
    expect(html).toContain("Nothing was sent to the cloud.");
    expect(html).not.toContain("Only the cleaned text you approved");
  });

  it("uses the cloud summary sentence when approved text was sent for a deeper check", () => {
    const html = buildReadablePrivacyReport(
      {
        ...baseReport,
        privacy_mode: "HYBRID_ANONYMIZED",
        cloud_inference_source: "in_cloud",
        approved_payload_sha256: "c".repeat(64),
      },
      { hiddenItems: hidden, findingsCount: 3 },
    );
    expect(html).toContain("Only the cleaned text you approved was sent for a deeper check.");
    expect(html).not.toContain("Nothing was sent to the cloud.");
  });

  it("never uses a details element", () => {
    const html = buildReadablePrivacyReport(baseReport, { hiddenItems: hidden, findingsCount: 3 });
    expect(html).not.toContain("<details");
  });

  it("contains the count of hidden items", () => {
    const html = buildReadablePrivacyReport(baseReport, { hiddenItems: hidden, findingsCount: 3 });
    expect(html).toContain("2 details were hidden before anything left this device.");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("person name");
  });

  it("is a complete standalone document with a title and no scripts", () => {
    const html = buildReadablePrivacyReport(baseReport, { hiddenItems: [], findingsCount: 0 });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>ClauseGuard privacy report</title>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
  });
});
