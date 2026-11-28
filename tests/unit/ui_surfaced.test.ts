import { describe, it, expect } from "vitest";
import {
  describeDeviceAi, downloadAnnouncement, fallbackReviewWarning, approvalId, whereCheckedLabel,
  practiceRunCard, FILE_LIMITS_TEXT, occurrenceLabel, roleTag,
} from "../../src/ui/viewModel.ts";

describe("surfaced view model", () => {
  it("chips and banner", () => {
    expect(describeDeviceAi("CHECKING", null).chip).toBe("On-device AI: checking…");
    expect(describeDeviceAi("DOWNLOADING", 42).chip).toBe("On-device AI: downloading 42%");
    expect(describeDeviceAi("DOWNLOADING", null).phoneChip).toBe("Downloading");
    expect(describeDeviceAi("READY_ON_DEVICE", null).phoneChip).toBe("Private ✓");
    expect(describeDeviceAi("OFFLINE", null).chip).toBe("On-device AI: offline, using built-in rules");
    expect(describeDeviceAi("DISABLED", null).chip).toBe("On-device AI: off, using built-in rules");
    expect(describeDeviceAi("DOWNLOADABLE_PENDING_WEIGHTS", null).banner?.kind).toBe("download");
    expect(describeDeviceAi("DOWNLOADING", 42).banner?.title).toBe("Downloading private AI… 42%");
    expect(describeDeviceAi("READY_ON_DEVICE", null).banner).toBeNull();
  });
  it("announcements", () => {
    expect(downloadAnnouncement(null, 1, "DOWNLOADING")).toBeTruthy();
    expect(downloadAnnouncement(10, 20, "DOWNLOADING")).toBeNull();
    expect(downloadAnnouncement(40, 55, "DOWNLOADING")).toBeTruthy();
    expect(downloadAnnouncement(60, 70, "DOWNLOADING")).toBeNull();
    expect(downloadAnnouncement(99, 100, "READY_ON_DEVICE")).toBe("Private AI is ready");
    expect(downloadAnnouncement(null, null, "READY_ON_DEVICE")).toBeNull();
  });
  it("fallback warning", () => {
    expect(fallbackReviewWarning("UNAVAILABLE")).toContain("Download private AI");
    expect(fallbackReviewWarning("OFFLINE")).toBe("Found with built-in rules. Names may be missed.");
    expect(fallbackReviewWarning("READY_ON_DEVICE")).toBeNull();
    expect(fallbackReviewWarning("CHECKING")).toBeNull();
    expect(fallbackReviewWarning("DOWNLOADING")).toBeNull();
  });
  it("approval id", () => {
    expect(approvalId("7f3a91c2deadbeef")).toBe("7F3A-91C2");
    expect(approvalId("NONE")).toBeNull();
    expect(approvalId(null)).toBeNull();
    expect(approvalId("abc")).toBeNull();
  });
  it("labels", () => {
    expect(whereCheckedLabel("in_cloud")).toBe("Checked in the cloud");
    expect(whereCheckedLabel("SIMULATED_CLOUD_SYNTHESIS")).toBe("Practice run");
    expect(whereCheckedLabel("on_device")).toBe("Checked on this device");
    expect(whereCheckedLabel("weird")).toBe("Checked on this device");
    expect(practiceRunCard(false, true).badge).toBe("Practice");
    expect(practiceRunCard(true, true).badge).toBeNull();
    expect(practiceRunCard(false, false).title).toBe("Deeper check is not set up");
    expect(FILE_LIMITS_TEXT).toContain("50 pages");
    expect(occurrenceLabel(1)).toBe("appears 1 time");
    expect(occurrenceLabel(4)).toBe("appears 4 times");
    expect(roleTag("PARTY")).toBeNull();
    expect(roleTag("DISCLOSING_PARTY")).toBe("Disclosing party");
  });
});

describe("cloud status after an App Check refusal", () => {
  it("stops saying protected once the cloud refused the app", async () => {
    const { describeCloud, isCloudVerificationError } = await import("../../src/ui/viewModel.ts");
    const t = { hasLiveCloudConfig: true } as Parameters<typeof describeCloud>[0];
    expect(describeCloud(t).chip).toBe("Cloud: protected");
    const refused = describeCloud(t, true);
    expect(refused.chip).toBe("Cloud: blocked");
    expect(refused.tone).toBe("warn");
    expect(refused.headline).toContain("nothing was sent");
    expect(describeCloud({ hasLiveCloudConfig: false } as typeof t, true).chip).toBe("Cloud: not set up");
    expect(isCloudVerificationError(new Error("[ERR_APP_CHECK_ATTESTATION_FAILED] token rejected"))).toBe(true);
    expect(isCloudVerificationError(new Error("network down"))).toBe(false);
  });
});
