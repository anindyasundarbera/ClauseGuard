import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeOnDeviceModelWithGesture,
  NANO_AVAILABILITY_TIMEOUT_MS,
  probeNanoReadiness,
  resetNanoAdapterStateForTests,
  runChunkOnDeviceNano,
  runLocalSingleClauseTriage,
  splitIntoTokenBoundedChunks,
} from "../../src/core/orchestration/nanoAdapter.ts";
import { ClauseGuardSessionController } from "../../src/core/sessionController.ts";
import { describeDeviceAi } from "../../src/ui/viewModel.ts";

type LmGlobal = { LanguageModel?: unknown };

/** Mimics stock Chrome with Prompt API flags off: API exposed, availability() never settles. */
function installHangingLanguageModel(): { calls: () => number } {
  let n = 0;
  (globalThis as unknown as LmGlobal).LanguageModel = {
    availability: () => {
      n++;
      return new Promise<string>(() => undefined);
    },
    create: async () => {
      throw new Error("create() must not be reached when availability() hangs");
    },
  };
  return { calls: () => n };
}

describe("LanguageModel.availability() startup timeout", () => {
  const originalLm = (globalThis as unknown as LmGlobal).LanguageModel;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetNanoAdapterStateForTests();
    if (originalLm === undefined) delete (globalThis as unknown as LmGlobal).LanguageModel;
    else (globalThis as unknown as LmGlobal).LanguageModel = originalLm;
  });

  it("uses a bounded timeout of a few seconds", () => {
    expect(NANO_AVAILABILITY_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(NANO_AVAILABILITY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("probeNanoReadiness resolves to UNAVAILABLE with fallback text instead of hanging", async () => {
    installHangingLanguageModel();
    let settled = false;
    const p = probeNanoReadiness().then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const res = await p;
    expect(res.state).toBe("UNAVAILABLE");
    expect(res.detail).toMatch(/did not answer within 4 s/);
    expect(res.detail).toMatch(/deterministic local detection/);

    const ui = describeDeviceAi(res.state, null);
    expect(ui.tone).toBe("warn");
    expect(ui.headline).toBe("Private AI on this device: not available — using safe fallback");
  });

  it("reports OFFLINE (not ERROR) when the probe times out while the browser is offline", async () => {
    installHangingLanguageModel();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const p = probeNanoReadiness();
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS);
    const res = await p;
    expect(res.state).toBe("OFFLINE");
    expect(res.detail).toMatch(/did not answer/);
  });

  it("does not wait again on later probes once availability() has hung", async () => {
    const lm = installHangingLanguageModel();
    const first = probeNanoReadiness();
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS);
    await first;
    expect(lm.calls()).toBe(1);

    // No timer advance: per-chunk probes must settle immediately.
    const second = await probeNanoReadiness();
    expect(second.state).toBe("UNAVAILABLE");
    expect(lm.calls()).toBe(1);
  });

  it("still reports READY_ON_DEVICE when availability() answers before the deadline", async () => {
    (globalThis as unknown as LmGlobal).LanguageModel = {
      availability: () => new Promise<string>((r) => setTimeout(() => r("available"), NANO_AVAILABILITY_TIMEOUT_MS - 500)),
    };
    const p = probeNanoReadiness();
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS - 500);
    expect((await p).state).toBe("READY_ON_DEVICE");
  });

  it("raw chunks and local triage fall back to deterministic mode after the timeout", async () => {
    installHangingLanguageModel();
    const chunk = splitIntoTokenBoundedChunks("Agreement with Sovereign Labs Inc. dated 2026.")[0];
    const chunkP = runChunkOnDeviceNano(chunk, "ONLY_ON_DEVICE");
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS);
    const chunkRes = await chunkP;
    expect(chunkRes.inferenceSource).toBe("DEGRADED_DETERMINISTIC_SAFE");
    expect(chunkRes.verifiedEntities).toEqual([]);

    const triage = await runLocalSingleClauseTriage("Liability is unlimited for data breaches.", "ONLY_ON_DEVICE");
    expect(triage.analysisSource).toBe("DETERMINISTIC_LOCAL_TRIAGE");
  });

  it("controller.refreshReadiness leaves CHECKING and sets the fallback badge and detail", async () => {
    installHangingLanguageModel();
    const ctrl = new ClauseGuardSessionController();
    expect(ctrl.readinessState).toBe("CHECKING");
    const p = ctrl.refreshReadiness();
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS);
    await p;
    expect(ctrl.readinessState).toBe("UNAVAILABLE");
    expect(ctrl.readinessDetail).toMatch(/did not answer/);
    expect(ctrl.privacyMode).toBe("LOCAL_ONLY");
    expect(ctrl.approvalMachine.getSnapshot().state).toBe("EMPTY");
  });

  it("the set-up button retries once and returns UNAVAILABLE instead of hanging", async () => {
    const lm = installHangingLanguageModel();
    const startup = probeNanoReadiness();
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS);
    await startup;

    const p = initializeOnDeviceModelWithGesture();
    await vi.advanceTimersByTimeAsync(NANO_AVAILABILITY_TIMEOUT_MS);
    const res = await p;
    expect(res.status).toBe("UNAVAILABLE");
    expect(res.detail).toMatch(/did not answer/);
    expect(lm.calls()).toBe(2);
  });
});
