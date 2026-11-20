import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  analyzeApprovedPayload,
  ApprovalStateMachine,
  PrivacyBoundaryError,
  runZeroCanaryPreflight,
} from "../../src/core/inference/approvalMachine.ts";
import { buildRedaction } from "../../src/core/redaction/redactor.ts";
import { ClauseGuardSessionController, SYNTHETIC_SAMPLE_CONTRACTS } from "../../src/core/sessionController.ts";
import {
  decryptWorkspaceSnapshot,
  encryptWorkspaceSnapshot,
  loadEncryptedWorkspaceFromIdb,
  purgeAllWorkspaceStorage,
  saveEncryptedWorkspaceToIdb,
} from "../../src/core/storage/encryptedVault.ts";
import { SafeLogger } from "../../src/core/telemetry/privacyReport.ts";
import type { DetectedEntity } from "../../src/core/types.ts";

describe("Approval State Machine, ZeroCanaryPreflight, WebCrypto Vault & Session Purge", () => {
  it("binds approval strictly to payload SHA-256 and invalidates immediately on edit", async () => {
    const text = "Contract with Meridian Precision Robotics GmbH cap $1,850,000.00 excluding confidentiality.";
    const ent: DetectedEntity = {
      id: "E1",
      surface: "Meridian Precision Robotics GmbH",
      canonicalKey: "ENT-MPR",
      canonicalName: "Meridian Precision Robotics GmbH",
      category: "ORG",
      role: "CLIENT",
      normStart: 14,
      normEnd: 46,
      source: "PREAMBLE_DEFINITION",
      confidence: 0.99,
      rationale: "test",
      reviewStatus: "ACCEPTED",
    };

    const red1 = await buildRedaction(text, [ent], 1);
    const machine = new ApprovalStateMachine();
    machine.transitionTo("PAYLOAD_PREVIEWED");

    // Must block cloud call prior to approval
    await expect(
      analyzeApprovedPayload(machine.getSnapshot(), red1, {
        cloudMode: "ONLY_IN_CLOUD",
        allowLocalSimulatedCloud: true,
      })
    ).rejects.toThrow(PrivacyBoundaryError);

    const approval = await machine.approveExactPayload(red1, 0);
    expect(approval.state).toBe("HUMAN_APPROVED_FOR_CLOUD");
    expect(approval.approvedPayloadSha256).toBe(red1.sanitizedSha256);

    // Mutate entity state -> invalidates approval & blocks stale replay
    machine.invalidateOnEdit();
    expect(machine.getSnapshot().state).toBe("STALE_APPROVAL_INVALIDATED");
    await expect(
      analyzeApprovedPayload(machine.getSnapshot(), red1, {
        cloudMode: "ONLY_IN_CLOUD",
        allowLocalSimulatedCloud: true,
      })
    ).rejects.toThrow(/ERR_UNAPPROVED_EGRESS_BLOCKED/);

    // Even if caller holds old ApprovalRecord, passing mutated redaction triggers ERR_STALE_APPROVAL_BLOCKED
    const red2 = await buildRedaction(text, [{ ...ent, reviewStatus: "REJECTED" }], 2);
    await expect(
      analyzeApprovedPayload(approval, red2, {
        cloudMode: "ONLY_IN_CLOUD",
        allowLocalSimulatedCloud: true,
      })
    ).rejects.toThrow(/ERR_STALE_APPROVAL_BLOCKED/);

    // Preflight catches unmasked accepted canary
    const leaked = { ...red1, sanitizedText: text };
    expect(runZeroCanaryPreflight(leaked).passed).toBe(false);
  });

  it("encrypts Workspace snapshots with PBKDF2-SHA256 + unique 96-bit IVs, rejects 1-bit tamper, and purges cleanly", async () => {
    const snap = {
      version: 1 as const,
      workspaceId: "WS-ALPHA",
      canonicalEntities: [
        {
          canonicalId: "ENT-1",
          canonicalName: "Meridian Precision Robotics GmbH",
          category: "ORG" as const,
          aliases: ["MPR"],
          trustState: "HUMAN_APPROVED" as const,
          updatedAtUtc: "2026-11-17T00:00:00Z",
        },
      ],
      rejectionAllowlist: ["delaware"],
      updatedAtUtc: "2026-11-17T00:00:00Z",
    };

    // Verify 0 IV collisions across 50 consecutive encryptions
    const ivs = new Set<string>();
    let lastRec = await encryptWorkspaceSnapshot(snap, "strong-passphrase-2026");
    ivs.add(lastRec.ivB64);
    for (let i = 0; i < 49; i++) {
      const r = await encryptWorkspaceSnapshot(snap, "strong-passphrase-2026");
      ivs.add(r.ivB64);
      lastRec = r;
    }
    expect(ivs.size).toBe(50);

    // Wrong passphrase rejected
    await expect(decryptWorkspaceSnapshot(lastRec, "wrong-passphrase")).rejects.toThrow();

    // 1-bit tamper rejected with OperationError
    const tampered = {
      ...lastRec,
      ciphertextB64:
        (lastRec.ciphertextB64[0] === "A" ? "B" : "A") + lastRec.ciphertextB64.slice(1),
    };
    await expect(decryptWorkspaceSnapshot(tampered, "strong-passphrase-2026")).rejects.toThrow();

    // Save -> Load -> Purge lifecycle in IndexedDB
    await saveEncryptedWorkspaceToIdb(snap, "strong-passphrase-2026");
    const loaded = await loadEncryptedWorkspaceFromIdb("WS-ALPHA", "strong-passphrase-2026");
    expect(loaded?.canonicalEntities[0].canonicalName).toBe("Meridian Precision Robotics GmbH");
    await purgeAllWorkspaceStorage();
    const afterPurge = await loadEncryptedWorkspaceFromIdb("WS-ALPHA", "strong-passphrase-2026");
    expect(afterPurge).toBeNull();
  }, 15_000);

  it("completes full end-to-end controller workflow, SafeLogger redaction, and 16-field Privacy Report", async () => {
    const ctrl = new ClauseGuardSessionController();
    ctrl.setFirebaseConfig(null);
    await ctrl.ingestFileOrText({
      fileName: SYNTHETIC_SAMPLE_CONTRACTS[0].fileName,
      mimeType: "text/plain",
      text: SYNTHETIC_SAMPLE_CONTRACTS[0].text,
    });
    expect(ctrl.redaction?.sanitizedText).not.toContain("Meridian Precision Robotics GmbH");
    expect(ctrl.redaction?.sanitizedText).not.toContain("DE89370400440532013000");

    // Regression: unresolved Airlock items must block approval
    await expect(ctrl.approveCurrentPayload()).rejects.toThrow(/ERR_UNRESOLVED_AIRLOCK_ITEMS/);
    await ctrl.acceptAllPendingEntities();
    expect(ctrl.redaction?.sanitizedText).not.toContain("Dr. Elena Vance");
    expect(ctrl.redaction?.sanitizedText).not.toContain("First National Bank of Delaware");

    ctrl.privacyMode = "HYBRID_ANONYMIZED";
    await ctrl.approveCurrentPayload();
    const findings = await ctrl.runApprovedCloudAnalysis({ allowSimulatedCloud: true });
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].rehydratedExcerpt).toContain("Meridian Precision Robotics GmbH");

    const rpt = ctrl.getPrivacyReport16();
    expect(Object.keys(rpt).length).toBe(16);
    expect(rpt.known_limitations_and_non_certification_disclaimer).toContain("NOT LEGAL/REGULATORY CERTIFICATION");
    expect(SafeLogger.sanitizeMessage("Leak test a@b.com sk-1234567890abcdef1234")).toBe(
      "Leak test [REDACTED_EMAIL] [REDACTED_KEY]"
    );
  });
});
