import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCloudFirebaseRuntime,
  resetCloudFirebaseRuntime,
  validateSupportedCloudModel,
} from "../../src/core/firebase/firebaseClient.ts";
import { enforceRemoteConfigSafetyInvariants } from "../../src/core/firebase/remoteConfigGuard.ts";
import {
  analyzeApprovedPayload,
  ApprovalStateMachine,
  PrivacyBoundaryError,
} from "../../src/core/inference/approvalMachine.ts";
import { buildRedaction } from "../../src/core/redaction/redactor.ts";
import {
  ClauseGuardSessionController,
  SYNTHETIC_SAMPLE_CONTRACTS,
} from "../../src/core/sessionController.ts";
import { SafeLogger } from "../../src/core/telemetry/privacyReport.ts";
import type { DetectedEntity } from "../../src/core/types.ts";

describe("Firebase AI Logic ONLY_IN_CLOUD, App Check, Remote Config & Adversarial Suite", () => {
  let activeServer: http.Server | null = null;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await resetCloudFirebaseRuntime();
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
  });

  function installJsdomAbortSignalFetchBridge(): void {
    // Bridge jsdom's AbortSignal realm difference with Node's native undici fetch during unit tests.
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init && "signal" in init) {
        const { signal: _dropJsdomSignal, ...rest } = init;
        return originalFetch(input, rest);
      }
      return originalFetch(input, init);
    };
  }

  async function buildApprovedFixture() {
    const rawText =
      "MSA between Meridian Precision Robotics GmbH ('CLIENT') and Northstar Strategic Advisory LLC ('ADVISOR'). " +
      "Wire IBAN DE89370400440532013000; contact elena.vance@meridian-robotics.de; canary sk-proj-99887766554433221100aabbccddeeff. " +
      "Clause 14.1 cap USD $1,850,000.00 excluding Clause 9.3 confidentiality breaches.";
    const entities: DetectedEntity[] = [
      {
        id: "E1",
        surface: "Meridian Precision Robotics GmbH",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: rawText.indexOf("Meridian Precision Robotics GmbH"),
        normEnd: rawText.indexOf("Meridian Precision Robotics GmbH") + "Meridian Precision Robotics GmbH".length,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.99,
        rationale: "Preamble",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "E2",
        surface: "Northstar Strategic Advisory LLC",
        canonicalKey: "ENT-NS",
        canonicalName: "Northstar Strategic Advisory LLC",
        category: "ORG",
        role: "ADVISOR",
        normStart: rawText.indexOf("Northstar Strategic Advisory LLC"),
        normEnd: rawText.indexOf("Northstar Strategic Advisory LLC") + "Northstar Strategic Advisory LLC".length,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.99,
        rationale: "Preamble",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "E3",
        surface: "DE89370400440532013000",
        canonicalKey: "IBAN-1",
        canonicalName: "DE89370400440532013000",
        category: "IBAN",
        role: "PARTY",
        normStart: rawText.indexOf("DE89370400440532013000"),
        normEnd: rawText.indexOf("DE89370400440532013000") + "DE89370400440532013000".length,
        source: "DETERMINISTIC_L1",
        confidence: 1.0,
        rationale: "Mod-97",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "E4",
        surface: "elena.vance@meridian-robotics.de",
        canonicalKey: "EMAIL-1",
        canonicalName: "elena.vance@meridian-robotics.de",
        category: "EMAIL",
        role: "PARTY",
        normStart: rawText.indexOf("elena.vance@meridian-robotics.de"),
        normEnd: rawText.indexOf("elena.vance@meridian-robotics.de") + "elena.vance@meridian-robotics.de".length,
        source: "DETERMINISTIC_L1",
        confidence: 1.0,
        rationale: "Email",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "E5",
        surface: "sk-proj-99887766554433221100aabbccddeeff",
        canonicalKey: "KEY-1",
        canonicalName: "sk-proj-99887766554433221100aabbccddeeff",
        category: "API_KEY",
        role: "PARTY",
        normStart: rawText.indexOf("sk-proj-99887766554433221100aabbccddeeff"),
        normEnd:
          rawText.indexOf("sk-proj-99887766554433221100aabbccddeeff") +
          "sk-proj-99887766554433221100aabbccddeeff".length,
        source: "DETERMINISTIC_L1",
        confidence: 1.0,
        rationale: "API Key",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "E6",
        surface: "$1,850,000.00",
        canonicalKey: "CAP-1",
        canonicalName: "$1,850,000.00",
        category: "CURRENCY_CAP",
        role: "PARTY",
        normStart: rawText.indexOf("$1,850,000.00"),
        normEnd: rawText.indexOf("$1,850,000.00") + "$1,850,000.00".length,
        source: "DETERMINISTIC_L1",
        confidence: 1.0,
        rationale: "Currency cap",
        reviewStatus: "ACCEPTED",
      },
    ];
    const redaction = await buildRedaction(rawText, entities, 1);
    const machine = new ApprovalStateMachine();
    machine.transitionTo("PAYLOAD_PREVIEWED");
    const approval = await machine.approveExactPayload(redaction, 0);
    return { rawText, redaction, approval };
  }

  it("rejects deprecated Gemini 1.x/2.x model IDs and permits Gemini 3+/4 free-tier models", () => {
    for (const oldModel of ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
      expect(() => validateSupportedCloudModel(oldModel)).toThrow(/ERR_DEPRECATED_GEMINI_MODEL/);
    }
    expect(() => validateSupportedCloudModel("unknown-model-x")).toThrow(/ERR_UNSUPPORTED_CLOUD_MODEL/);
    expect(validateSupportedCloudModel("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(validateSupportedCloudModel("gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(validateSupportedCloudModel("gemini-4-hydrogen")).toBe("gemini-4-hydrogen");
  });

  it("blocks Remote Config tampering that attempts to weaken ONLY_ON_DEVICE, Airlock approval, or App Check", () => {
    expect(() =>
      enforceRemoteConfigSafetyInvariants({ local_inference_mode: "PREFER_ON_DEVICE" })
    ).toThrow(/ERR_REMOTE_CONFIG_INVARIANT_VIOLATION/);
    expect(() =>
      enforceRemoteConfigSafetyInvariants({ local_inference_mode: "ONLY_IN_CLOUD" })
    ).toThrow(/ERR_REMOTE_CONFIG_INVARIANT_VIOLATION/);
    expect(() =>
      enforceRemoteConfigSafetyInvariants({ require_human_airlock_approval: false })
    ).toThrow(/ERR_REMOTE_CONFIG_INVARIANT_VIOLATION/);
    expect(() =>
      enforceRemoteConfigSafetyInvariants({ enable_zero_canary_preflight: "false" })
    ).toThrow(/ERR_REMOTE_CONFIG_INVARIANT_VIOLATION/);
    expect(() =>
      enforceRemoteConfigSafetyInvariants({ enforce_app_check: false })
    ).toThrow(/ERR_REMOTE_CONFIG_INVARIANT_VIOLATION/);

    const safe = enforceRemoteConfigSafetyInvariants({
      cloud_model_name: "gemini-4-hydrogen",
      playbook_id: "NDA_CARVEOUT_AUDIT",
      max_cloud_output_tokens: 99999,
    });
    expect(safe.cloudModelName).toBe("gemini-4-hydrogen");
    expect(safe.playbookId).toBe("NDA_CARVEOUT_AUDIT");
    expect(safe.maxCloudOutputTokens).toBe(4096);
    expect(safe.safetyInvariantsLocked).toBe(true);
  });

  it("enforces App Check initialization order before getAI and blocks missing/failed attestation", async () => {
    const { redaction, approval } = await buildApprovedFixture();

    await expect(
      ensureCloudFirebaseRuntime({
        apiKey: "test-key-123",
        projectId: "test-proj-id",
        appId: "1:123456:web:abcdef",
      })
    ).rejects.toThrow(/ERR_APP_CHECK_NOT_CONFIGURED/);

    const handle = await ensureCloudFirebaseRuntime({
      apiKey: "test-key-123",
      projectId: "test-proj-id",
      appId: "1:123456:web:abcdef",
      customAppCheckTokenProvider: async () => ({
        token: "custom-attestation-token-xyz",
        expireTimeMillis: Date.now() + 3600_000,
      }),
    });
    handle.createCloudModel("gemini-3.5-flash-lite");
    expect(handle.initSequence).toEqual([
      "initializeApp",
      "initializeAppCheck",
      "getAI",
      "getGenerativeModel(ONLY_IN_CLOUD)",
    ]);

    // Empty / failed attestation blocks cloud dispatch before any network packet leaves
    await expect(
      analyzeApprovedPayload(approval, redaction, {
        cloudMode: "ONLY_IN_CLOUD",
        firebaseConfig: {
          apiKey: "test-key-123",
          projectId: "test-proj-id",
          appId: "1:123456:web:abcdef",
          customAppCheckTokenProvider: async () => ({
            token: "",
            expireTimeMillis: Date.now() + 3600_000,
          }),
        },
      })
    ).rejects.toThrow(/ERR_APP_CHECK_ATTESTATION_FAILED/);
  });

  it("executes real @firebase/ai ONLY_IN_CLOUD wire protocol with X-Firebase-AppCheck, 0 raw canaries, and local rehydration", async () => {
    const { redaction, approval } = await buildApprovedFixture();
    const capturedRequests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

    activeServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        capturedRequests.push({
          url: req.url ?? "",
          headers: req.headers,
          body: rawBody,
        });
        const responseJson = {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: JSON.stringify({
                      findings: [
                        {
                          severity: "HIGH",
                          title: "Uncapped Confidentiality Carve-Out",
                          clauseRefs: ["Clause 14.1", "Clause 9.3"],
                          anonymizedExcerpt:
                            "[ORG_CLIENT_1] cap [CAP_1M_PLUS_6] vs carve-out and forged [ORG_CLIENT_999]",
                          rationale:
                            "[ORG_CLIENT_1] liability cap may be undermined by Clause 9.3 carve-out.",
                        },
                      ],
                    }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseJson));
      });
    });

    await new Promise<void>((resolve) => activeServer!.listen(0, "127.0.0.1", resolve));
    const addr = activeServer.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    installJsdomAbortSignalFetchBridge();

    const findings = await analyzeApprovedPayload(approval, redaction, {
      cloudMode: "ONLY_IN_CLOUD",
      modelId: "gemini-3.5-flash-lite",
      firebaseConfig: {
        apiKey: "test-firebase-api-key",
        projectId: "test-proj-id",
        appId: "1:123456:web:abcdef",
        firebaseBaseUrl: baseUrl,
        customAppCheckTokenProvider: async () => ({
          token: "appcheck-verified-jwt-mock",
          expireTimeMillis: Date.now() + 3600_000,
        }),
      },
    });

    expect(capturedRequests).toHaveLength(1);
    const req0 = capturedRequests[0];
    expect(req0.url).toBe(
      "/v1beta/projects/test-proj-id/models/gemini-3.5-flash-lite:generateContent"
    );
    expect(req0.headers["x-firebase-appcheck"]).toBe("appcheck-verified-jwt-mock");
    expect(req0.headers["x-goog-api-key"]).toBe("test-firebase-api-key");
    expect(String(req0.headers["x-goog-api-client"])).toContain("gl-js/3.1.0");
    expect(String(req0.headers["x-goog-api-client"])).toContain("fire/3.1.0");

    // Zero raw canaries in outbound @firebase/ai POST payload
    for (const canary of [
      "Meridian Precision Robotics GmbH",
      "Northstar Strategic Advisory LLC",
      "DE89370400440532013000",
      "elena.vance@meridian-robotics.de",
      "sk-proj-99887766554433221100aabbccddeeff",
      "$1,850,000.00",
    ]) {
      expect(req0.body).not.toContain(canary);
    }
    expect(req0.body).toContain("[ORG_CLIENT_1]");

    expect(findings).toHaveLength(1);
    expect(findings[0].analysisSource).toBe("FIREBASE_AI_LOGIC_ONLY_IN_CLOUD");
    expect(findings[0].observedInferenceSource).toBe("in_cloud");
    expect(findings[0].rehydratedExcerpt).toContain("Meridian Precision Robotics GmbH");
    expect(findings[0].rehydratedExcerpt).toContain("[UNMAPPED_TOKEN:ORG_CLIENT_999]");
    expect(findings[0].unmappedTokens).toEqual(["[ORG_CLIENT_999]"]);
  });

  it("rejects malformed or oversized cloud responses and redacts App Check debug tokens in SafeLogger", async () => {
    const { redaction, approval } = await buildApprovedFixture();
    let mode: "malformed" | "oversized" = "malformed";

    activeServer = http.createServer((_req, res) => {
      const textPayload =
        mode === "malformed"
          ? "NOT_VALID_JSON"
          : JSON.stringify({
              findings: Array.from({ length: 30 }, (_, i) => ({
                severity: "LOW",
                title: `F${i}`,
                clauseRefs: ["1"],
                anonymizedExcerpt: "x",
                rationale: "y",
              })),
            });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: textPayload }] }, finishReason: "STOP" }],
        })
      );
    });
    await new Promise<void>((resolve) => activeServer!.listen(0, "127.0.0.1", resolve));
    const addr = activeServer.address() as { port: number };
    installJsdomAbortSignalFetchBridge();

    const cfg = {
      apiKey: "test-key",
      projectId: "test-proj-id",
      appId: "1:123456:web:abcdef",
      firebaseBaseUrl: `http://127.0.0.1:${addr.port}`,
      customAppCheckTokenProvider: async () => ({
        token: "tok",
        expireTimeMillis: Date.now() + 3600_000,
      }),
    };

    await expect(
      analyzeApprovedPayload(approval, redaction, { cloudMode: "ONLY_IN_CLOUD", firebaseConfig: cfg })
    ).rejects.toThrow();

    mode = "oversized";
    await expect(
      analyzeApprovedPayload(approval, redaction, { cloudMode: "ONLY_IN_CLOUD", firebaseConfig: cfg })
    ).rejects.toThrow(PrivacyBoundaryError);

    expect(
      SafeLogger.sanitizeMessage(
        "FIREBASE_APPCHECK_DEBUG_TOKEN=123e4567-e89b-12d3-a456-426614174000 key=AIzaSyDummyKeyValue1234567890"
      )
    ).toBe("FIREBASE_APPCHECK_DEBUG_TOKEN=[REDACTED] key=[REDACTED_KEY]");
  });

  it("aborts and discards in-flight cloud analysis if an entity is edited mid-request (M-01)", async () => {
    const ctrl = new ClauseGuardSessionController();
    await ctrl.ingestFileOrText({
      fileName: SYNTHETIC_SAMPLE_CONTRACTS[0].fileName,
      mimeType: "text/plain",
      text: SYNTHETIC_SAMPLE_CONTRACTS[0].text,
    });
    await ctrl.acceptAllPendingEntities();
    ctrl.privacyMode = "HYBRID_ANONYMIZED";
    await ctrl.approveCurrentPayload();

    let serverResponded = false;
    activeServer = http.createServer((_req, res) => {
      setTimeout(() => {
        serverResponded = true;
        if (!res.destroyed) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ text: JSON.stringify({ findings: [] }) }],
                  },
                  finishReason: "STOP",
                },
              ],
            })
          );
        }
      }, 150);
    });
    await new Promise<void>((resolve) => activeServer!.listen(0, "127.0.0.1", resolve));
    const addr = activeServer.address() as { port: number };

    let abortedBySignal = false;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const sig = init?.signal;
      const { signal: _drop, ...rest } = init ?? {};
      return new Promise<Response>((resolve, reject) => {
        if (sig?.aborted) {
          abortedBySignal = true;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        sig?.addEventListener(
          "abort",
          () => {
            abortedBySignal = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
        originalFetch(input, rest).then(resolve, reject);
      });
    };

    ctrl.setFirebaseConfig({
      apiKey: "test-key-m01",
      projectId: "test-proj-m01",
      appId: "1:123456:web:m01",
      firebaseBaseUrl: `http://127.0.0.1:${addr.port}`,
      cloudModelId: "gemini-3.5-flash-lite",
      customAppCheckTokenProvider: async () => ({
        token: "tok-m01",
        expireTimeMillis: Date.now() + 3600_000,
      }),
    });

    const inFlight = ctrl.runApprovedCloudAnalysis({ allowSimulatedCloud: false });
    const caughtPromise = inFlight.then(
      () => null as unknown,
      (err: unknown) => err
    );
    await new Promise((r) => setTimeout(r, 25));
    await ctrl.toggleEntityStatus(ctrl.entities[0].id, "REJECTED");

    const settledErr = await caughtPromise;
    expect(settledErr).not.toBeNull();
    expect(String(settledErr)).toMatch(/AbortError|Aborted|STALE/i);
    expect(abortedBySignal || ctrl.approvalMachine.getSnapshot().state === "STALE_APPROVAL_INVALIDATED").toBe(
      true
    );
    expect(ctrl.approvalMachine.getSnapshot().state).toBe("STALE_APPROVAL_INVALIDATED");
    expect(ctrl.findings).toEqual([]);
    await new Promise((r) => setTimeout(r, 170));
    expect(typeof serverResponded).toBe("boolean");
  });
});
