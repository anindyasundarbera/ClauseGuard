import { describe, expect, it } from "vitest";
import { buildSamples } from "../../src/ui/samples.ts";
import {
  categoryLabel,
  cleanFindingTitle,
  finishLede,
  manualAddFeedback,
  undecidedHiddenText,
  describeCloud,
  describeDeviceAi,
  furthestStep,
  friendlyError,
  ledgerCounts,
  plainWarnings,
  shieldProgress,
  splitPlaceholders,
} from "../../src/ui/viewModel.ts";
import type { DetectedEntity, ObservedFirebaseTelemetry } from "../../src/core/types.ts";
import { ClauseGuardSessionController } from "../../src/core/sessionController.ts";

const ent = (id: string, category: DetectedEntity["category"], reviewStatus: DetectedEntity["reviewStatus"]): DetectedEntity => ({
  id, surface: id, canonicalKey: id, canonicalName: id, category, role: "PARTY",
  normStart: 0, normEnd: 1, source: "DETERMINISTIC_L1", confidence: 1, rationale: "", reviewStatus,
});

describe("plain-language status", () => {
  it("never leaks raw state names in headlines", () => {
    for (const st of ["CHECKING", "READY_ON_DEVICE", "DOWNLOADABLE_PENDING_WEIGHTS", "DOWNLOADING", "UNAVAILABLE", "DISABLED", "DEGRADED_DETERMINISTIC_SAFE", "OFFLINE", "ERROR"] as const) {
      const s = describeDeviceAi(st, null);
      expect(s.headline + s.help).not.toMatch(/DEGRADED|NOT_INITIALIZED|ONLY_ON_DEVICE|[A-Z]{4,}_[A-Z]{3,}/);
    }
    expect(describeDeviceAi("READY_ON_DEVICE", null).headline).toBe("Private AI on this device: ready");
    expect(describeDeviceAi("DEGRADED_DETERMINISTIC_SAFE", null).headline).toContain("using safe fallback");
  });
  it("describes cloud status without implying egress when unconfigured", () => {
    const t = { hasLiveCloudConfig: false } as ObservedFirebaseTelemetry;
    expect(describeCloud(t).headline).toContain("nothing is sent");
  });
});

describe("ledger", () => {
  it("counts hidden, visible and pending items", () => {
    const c = ledgerCounts([ent("a", "EMAIL", "ACCEPTED"), ent("b", "EMAIL", "ACCEPTED"), ent("c", "PERSON", "REJECTED"), ent("d", "ORG", "PENDING_REVIEW")]);
    expect(c.hiddenTotal).toBe(2);
    expect(c.visibleTotal).toBe(1);
    expect(c.pendingTotal).toBe(1);
    expect(c.hiddenByCategory[0].label).toBe("2 email addresses");
    expect(categoryLabel("PERSON", 1)).toBe("person's name");
  });
  it("splits placeholders for highlighting", () => {
    const segs = splitPlaceholders("Hi [ORG_PARTY_1], pay [CAP_UNDER_100K_2].");
    expect(segs.filter((s) => s.placeholder).map((s) => s.text)).toEqual(["[ORG_PARTY_1]", "[CAP_UNDER_100K_2]"]);
    expect(segs.map((s) => s.text).join("")).toBe("Hi [ORG_PARTY_1], pay [CAP_UNDER_100K_2].");
  });
});

describe("steps, warnings, errors", () => {
  it("gates steps by progress", () => {
    expect(furthestStep(false, false)).toBe(1);
    expect(furthestStep(true, false)).toBe(3);
    expect(furthestStep(true, true)).toBe(4);
  });
  it("collapses technical warnings", () => {
    const out = plainWarnings(["Chunk 1: Chrome LanguageModel reported 'unavailable'; failing closed", "Chunk 2: Chrome LanguageModel reported 'unavailable'; failing closed", "Stripped 1 invisible Unicode Cf characters during NFKC normalization."]);
    expect(out).toHaveLength(2);
    expect(out[1]).toContain("Stripped 1 invisible");
  });
  it("makes errors readable", () => {
    expect(friendlyError(new Error("PrivacyBoundaryError: Blocked outbound cloud call: state is 'EMPTY'."))).toContain("Blocked outbound");
    expect(friendlyError(new Error("ERR_APP_CHECK_ATTESTATION_FAILED x"))).toContain("nothing was sent");
  });
});

describe("samples run through the real local pipeline", () => {
  it("includes lease, medical bill and original contract ids", () => {
    const ids = buildSamples().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["sample-tenant-lease", "sample-medical-bill", "sample-msa-trap", "sample-dpa-collision", "sample-adversarial-injection"]));
  });
  for (const id of ["sample-tenant-lease", "sample-medical-bill"]) {
    it(`${id}: sanitized payload contains no raw email, IBAN or SSN`, async () => {
      const smp = buildSamples().find((s) => s.id === id)!;
      const c = new ClauseGuardSessionController();
      await c.ingestFileOrText({ fileName: smp.fileName, mimeType: "text/plain", text: smp.text });
      await c.acceptAllPendingEntities();
      const out = c.redaction!.sanitizedText;
      expect(c.entities.length).toBeGreaterThan(3);
      expect(out).not.toMatch(/@example\.com|DE89370400440532013000|999-01-4242/);
      await expect(c.approveCurrentPayload()).resolves.toBeTruthy();
    });
  }
});

describe("shield progress", () => {
  it("reports partial progress", () => {
    expect(shieldProgress(6, 10)).toEqual({ pct: 60, complete: false, label: "6 of 10 decided", shortLabel: "6/10", ariaLabel: "6 of 10 details decided" });
  });
  it("reports all decided", () => {
    const s = shieldProgress(4, 4);
    expect(s.pct).toBe(100);
    expect(s.complete).toBe(true);
    expect(s.label).toBe("All decided");
  });
  it("clamps and handles zero", () => {
    expect(shieldProgress(0, 0).pct).toBe(0);
    expect(shieldProgress(0, 0).complete).toBe(false);
    expect(shieldProgress(9, 5).pct).toBe(100);
    expect(shieldProgress(-2, 5).pct).toBe(0);
  });
});

describe("calm Review and Results wording", () => {
  it("strips engine words from finding titles", () => {
    expect(cleanFindingTitle("[HIGH_RISK] Uncapped liability")).toBe("Uncapped liability");
    expect(cleanFindingTitle("Local Deterministic Triage: Exclusion keyword")).toBe("Exclusion keyword");
    const nano = cleanFindingTitle("On-Device Gemini Nano Clause Triage (Firebase ONLY_ON_DEVICE)");
    expect(nano).not.toMatch(/Nano|Firebase|ONLY_|Deterministic|Triage:/i);
    expect(nano.length).toBeGreaterThan(0);
    expect(cleanFindingTitle("Auto-renewal in 60 days")).toBe("Auto-renewal in 60 days");
  });
  it("words the undecided-hidden toast and the finish line", () => {
    expect(undecidedHiddenText(1)).toBe("1 undecided detail was hidden.");
    expect(undecidedHiddenText(3)).toBe("3 undecided details were hidden.");
    expect(finishLede(21, false)).toBe("21 details kept private. Nothing personal was sent.");
    expect(finishLede(1, true)).toBe("1 detail kept private. Only the cleaned text was sent.");
  });
  it("gives feedback under the manual form", () => {
    expect(manualAddFeedback("Jordan Ellis", 3, "Person's name")).toEqual({
      ok: true,
      text: "Hidden in 3 places. Added to the list as Person's name.",
    });
    const miss = manualAddFeedback("Zed", 0, "Person's name");
    expect(miss.ok).toBe(false);
    expect(miss.text).toContain("Zed");
  });
});
