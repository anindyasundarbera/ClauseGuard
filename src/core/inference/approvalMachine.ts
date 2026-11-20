import { PrivacyBoundaryError } from "../errors.ts";
import {
  DEFAULT_CLOUD_MODEL_ID,
  ensureCloudFirebaseRuntime,
  InferenceSource,
  isLiveFirebaseConfig,
  SUPPORTED_FIREBASE_CLOUD_MODELS,
  validateSupportedCloudModel,
} from "../firebase/firebaseClient.ts";
import { sha256Hex } from "../ingestion/normalizer.ts";
import { rehydrateText } from "../redaction/redactor.ts";
import type {
  AppCheckStatus,
  ApprovalState,
  CloudInferenceMode,
  ContractFinding,
  FirebaseRuntimeConfig,
  HumanApprovedPayload,
  RedactionResult,
  SupportedFirebaseCloudModel,
} from "../types.ts";

export { PrivacyBoundaryError };

export interface ApprovalRecord {
  state: ApprovalState;
  approvedPayloadSha256: string | null;
  approvedMapVersion: number | null;
  approvedAtUtc: string | null;
  approvedBrandPayload: HumanApprovedPayload | null;
}

/**
 * Deterministic State Machine enforcing SHA-256-bound human review before any cloud call.
 * Any modification to entities or text invalidates prior approvals immediately.
 */
export class ApprovalStateMachine {
  private state: ApprovalState = "EMPTY";
  private approvedSha256: string | null = null;
  private approvedMapVersion: number | null = null;
  private approvedAtUtc: string | null = null;
  private approvedPayload: HumanApprovedPayload | null = null;

  public getSnapshot(): ApprovalRecord {
    return {
      state: this.state,
      approvedPayloadSha256: this.approvedSha256,
      approvedMapVersion: this.approvedMapVersion,
      approvedAtUtc: this.approvedAtUtc,
      approvedBrandPayload: this.approvedPayload,
    };
  }

  public transitionTo(next: ApprovalState): void {
    this.state = next;
    if (next !== "HUMAN_APPROVED_FOR_CLOUD" && next !== "CLOUD_ANALYZED" && next !== "REHYDRATED") {
      this.approvedSha256 = null;
      this.approvedMapVersion = null;
      this.approvedAtUtc = null;
      this.approvedPayload = null;
    }
  }

  public invalidateOnEdit(): void {
    if (
      this.state === "HUMAN_APPROVED_FOR_CLOUD" ||
      this.state === "CLOUD_ANALYZED" ||
      this.state === "REHYDRATED"
    ) {
      this.state = "STALE_APPROVAL_INVALIDATED";
    } else if (this.state === "PAYLOAD_PREVIEWED") {
      this.state = "IN_REVIEW";
    }
    this.approvedSha256 = null;
    this.approvedMapVersion = null;
    this.approvedAtUtc = null;
    this.approvedPayload = null;
  }

  public async approveExactPayload(
    redaction: RedactionResult,
    unresolvedCount: number
  ): Promise<ApprovalRecord> {
    if (unresolvedCount > 0) {
      throw new PrivacyBoundaryError(
        "ERR_UNRESOLVED_AIRLOCK_ITEMS",
        `Resolve all ${unresolvedCount} pending/needs-decision Airlock items before approving cloud payload.`
      );
    }
    if (
      this.state !== "PAYLOAD_PREVIEWED" &&
      this.state !== "STALE_APPROVAL_INVALIDATED" &&
      this.state !== "IN_REVIEW" &&
      this.state !== "REHYDRATED"
    ) {
      throw new PrivacyBoundaryError(
        "ERR_INVALID_APPROVAL_STATE",
        `Cannot approve payload while in state '${this.state}'.`
      );
    }
    const zeroPreflight = runZeroCanaryPreflight(redaction);
    if (!zeroPreflight.passed) {
      throw new PrivacyBoundaryError(
        "ERR_ZERO_CANARY_PREFLIGHT_FAILED",
        `Blocked approval: sensitive raw substrings detected in outgoing payload (${zeroPreflight.leaks.length} leaks).`
      );
    }
    const computedSha = await sha256Hex(redaction.sanitizedText);
    if (computedSha !== redaction.sanitizedSha256) {
      throw new PrivacyBoundaryError("ERR_SHA_MISMATCH", "Sanitized payload digest mismatch.");
    }
    this.state = "HUMAN_APPROVED_FOR_CLOUD";
    this.approvedSha256 = computedSha;
    this.approvedMapVersion = redaction.mapVersion;
    this.approvedAtUtc = new Date().toISOString();
    this.approvedPayload = redaction.sanitizedText as HumanApprovedPayload;
    return this.getSnapshot();
  }
}

/** Assert zero accepted raw entities (>= 4 chars) or raw secret regexes exist in outgoing sanitized text. */
export function runZeroCanaryPreflight(redaction: RedactionResult): {
  passed: boolean;
  leaks: string[];
} {
  const leaks: string[] = [];
  const lowerOut = redaction.sanitizedText.toLowerCase();

  for (const entry of redaction.entries) {
    const raw = entry.originalSurface.trim();
    if (raw.length >= 4 && lowerOut.includes(raw.toLowerCase())) {
      leaks.push(`Accepted entity surface leaked (${entry.category})`);
    }
  }
  if (/\b(?:sk-[A-Za-z0-9_-]{16,80}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{20,60})\b/.test(redaction.sanitizedText)) {
    leaks.push("Raw API credential pattern present");
  }
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,12}\b/.test(redaction.sanitizedText)) {
    leaks.push("Raw email pattern present");
  }
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/.test(redaction.sanitizedText)) {
    leaks.push("Raw IBAN pattern present");
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(redaction.sanitizedText)) {
    leaks.push("Raw SSN pattern present");
  }
  return { passed: leaks.length === 0, leaks: Array.from(new Set(leaks)) };
}

export interface CloudDispatchOptions {
  cloudMode: CloudInferenceMode;
  firebaseConfig?: Partial<FirebaseRuntimeConfig> | null;
  modelId?: string;
  playbookId?: string;
  allowLocalSimulatedCloud?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onFirebaseTelemetry?: (info: {
    appCheckStatus: AppCheckStatus;
    initSequence: string[];
    modelUsed: string;
  }) => void;
}

const VALID_SEVERITIES = new Set(["HIGH", "MEDIUM", "LOW"]);

function validateAndNormalizeCloudFindings(
  rawText: string,
  tokenToSurface: Record<string, string>,
  modelUsed: string
): ContractFinding[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { findings?: unknown };
  if (!parsed || !Array.isArray(parsed.findings)) {
    throw new PrivacyBoundaryError(
      "ERR_INVALID_CLOUD_SCHEMA",
      "Firebase AI Logic cloud response did not match required {findings: [...]} JSON schema."
    );
  }
  if (parsed.findings.length > 25) {
    throw new PrivacyBoundaryError(
      "ERR_CLOUD_RESPONSE_OVERSIZED",
      "Cloud response exceeded maximum 25 findings safety cap."
    );
  }

  return parsed.findings.map((item, idx) => {
    const f = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const rawSev = typeof f.severity === "string" ? f.severity.toUpperCase() : "MEDIUM";
    const severity = (VALID_SEVERITIES.has(rawSev) ? rawSev : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW";
    const title =
      typeof f.title === "string" && f.title.trim().length > 0
        ? f.title.trim().slice(0, 180)
        : "Cross-Clause Cloud Risk Finding";
    const clauseRefs = Array.isArray(f.clauseRefs)
      ? f.clauseRefs.filter((r): r is string => typeof r === "string").slice(0, 10)
      : ["Cloud Analysis"];
    const anon = typeof f.anonymizedExcerpt === "string" ? f.anonymizedExcerpt.slice(0, 800) : "";
    const rationaleRaw = typeof f.rationale === "string" ? f.rationale.slice(0, 1600) : "";

    const rehExcerpt = rehydrateText(anon, tokenToSurface);
    const rehRationale = rehydrateText(rationaleRaw, tokenToSurface);
    const combinedUnmapped = Array.from(
      new Set([...rehExcerpt.unmappedTokens, ...rehRationale.unmappedTokens])
    );

    return {
      findingId: `FIREBASE-CLD-${idx + 1}`,
      severity,
      title,
      clauseRefs: clauseRefs.length > 0 ? clauseRefs : ["General Review"],
      anonymizedExcerpt: anon,
      rehydratedExcerpt: rehExcerpt.rehydratedText,
      unmappedTokens: combinedUnmapped,
      rationale: rehRationale.rehydratedText,
      analysisSource: "FIREBASE_AI_LOGIC_ONLY_IN_CLOUD",
      observedInferenceSource: "in_cloud",
      modelUsed,
    };
  });
}

/**
 * Analyze the exact human-approved sanitized payload strictly via Firebase AI Logic
 * `InferenceMode.ONLY_IN_CLOUD` + App Check (or explicitly labeled local simulation when
 * no Firebase project config is present).
 * Refuses to execute unless ApprovalRecord is HUMAN_APPROVED_FOR_CLOUD and
 * live SHA-256 matches approvedPayloadSha256.
 */
export async function analyzeApprovedPayload(
  approval: ApprovalRecord,
  currentRedaction: RedactionResult,
  opts: CloudDispatchOptions
): Promise<ContractFinding[]> {
  if (opts.cloudMode !== "ONLY_IN_CLOUD") {
    throw new PrivacyBoundaryError("ERR_CLOUD_MODE", "Cloud synthesis must specify ONLY_IN_CLOUD.");
  }
  if (approval.state !== "HUMAN_APPROVED_FOR_CLOUD" || !approval.approvedBrandPayload) {
    throw new PrivacyBoundaryError(
      "ERR_UNAPPROVED_EGRESS_BLOCKED",
      `Blocked outbound cloud call: state is '${approval.state}'.`
    );
  }
  const currentSha = await sha256Hex(currentRedaction.sanitizedText);
  if (
    currentSha !== approval.approvedPayloadSha256 ||
    currentRedaction.mapVersion !== approval.approvedMapVersion
  ) {
    throw new PrivacyBoundaryError(
      "ERR_STALE_APPROVAL_BLOCKED",
      "Payload or entity review changed after approval. Re-review and re-approve before cloud submission."
    );
  }
  const preflight = runZeroCanaryPreflight(currentRedaction);
  if (!preflight.passed) {
    throw new PrivacyBoundaryError(
      "ERR_ZERO_CANARY_FAILED",
      `Blocked cloud submission by ZeroCanaryPreflight: ${preflight.leaks.join("; ")}`
    );
  }

  const sanitizedText: string = approval.approvedBrandPayload;

  // Path 1: Official Firebase AI Logic SDK (ONLY_IN_CLOUD + App Check)
  const hasFirebase = isLiveFirebaseConfig(opts.firebaseConfig);
  if (hasFirebase) {
    const requestedModel = opts.modelId ?? opts.firebaseConfig?.cloudModelId ?? DEFAULT_CLOUD_MODEL_ID;
    const validatedModel = validateSupportedCloudModel(requestedModel);
    const handle = await ensureCloudFirebaseRuntime(opts.firebaseConfig as FirebaseRuntimeConfig);

    const attestation = await handle.verifyAppCheckAttestation();
    if (!attestation.ok) {
      throw new PrivacyBoundaryError("ERR_APP_CHECK_ATTESTATION_FAILED", attestation.detail);
    }

    // Re-verify preflight right before network dispatch
    const finalPreflight = runZeroCanaryPreflight(currentRedaction);
    if (!finalPreflight.passed) {
      throw new PrivacyBoundaryError(
        "ERR_ZERO_CANARY_FAILED",
        `Blocked immediately prior to Firebase AI Logic call: ${finalPreflight.leaks.join("; ")}`
      );
    }

    const playbook = opts.playbookId ?? "COMMERCIAL_MSA_CONTRADICTION";
    const prompt =
      `Playbook: ${playbook}\n` +
      `Payload-SHA256: ${approval.approvedPayloadSha256}\n` +
      `Analyze ONLY the sanitized contract text below for cross-clause risk contradictions:\n\n${sanitizedText}`;

    const isCustomMockEndpoint = Boolean(opts.firebaseConfig?.firebaseBaseUrl);
    const candidateModels: SupportedFirebaseCloudModel[] = isCustomMockEndpoint
      ? [validatedModel]
      : [validatedModel, ...SUPPORTED_FIREBASE_CLOUD_MODELS.filter((m) => m !== validatedModel)];

    const sleepBrief = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        if (opts.signal?.aborted) {
          resolve();
          return;
        }
        setTimeout(resolve, ms);
      });

    let lastErr: unknown;
    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const activeModel = candidateModels[mIdx];
      const maxTries = isCustomMockEndpoint ? 1 : mIdx === 0 ? 2 : 1;
      for (let attempt = 0; attempt < maxTries; attempt++) {
        if (opts.signal?.aborted) {
          throw new PrivacyBoundaryError(
            "ERR_STALE_APPROVAL_BLOCKED",
            "Cloud request aborted because contract state changed."
          );
        }
        try {
          const cloudModel = handle.createCloudModel(activeModel);
          const result = await cloudModel.generateContent(prompt, {
            signal: opts.signal,
            timeout: opts.timeoutMs ?? 30_000,
          });

          if (result.response.inferenceSource !== InferenceSource.IN_CLOUD) {
            throw new PrivacyBoundaryError(
              "ERR_UNEXPECTED_INFERENCE_SOURCE",
              `Expected inferenceSource 'in_cloud' from ONLY_IN_CLOUD model, observed '${String(result.response.inferenceSource)}'.`
            );
          }

          opts.onFirebaseTelemetry?.({
            appCheckStatus: handle.appCheckStatus,
            initSequence: handle.initSequence,
            modelUsed: activeModel,
          });

          return validateAndNormalizeCloudFindings(
            result.response.text(),
            currentRedaction.tokenToSurface,
            activeModel
          );
        } catch (err) {
          lastErr = err;
          if (opts.signal?.aborted || isCustomMockEndpoint) {
            throw err;
          }
          const isTransientDemand = /500|503|429|high demand|overloaded|temporarily|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(
            String(err)
          );
          if (!isTransientDemand) {
            throw err;
          }
          await sleepBrief(500);
        }
      }
    }
    throw lastErr;
  }

  // Path 2: Explicitly labeled local simulated cloud cross-clause analyzer (0 external packets)
  if (!opts.allowLocalSimulatedCloud) {
    throw new PrivacyBoundaryError(
      "ERR_NO_FIREBASE_CLOUD_CONFIG",
      "No Firebase Web project configuration found. Configure Firebase + App Check or enable labeled simulated synthesis mode."
    );
  }

  return runSimulatedSanitizedCloudAnalysis(sanitizedText, currentRedaction.tokenToSurface);
}

/** Clearly labeled deterministic local simulation of cross-clause cloud reasoning over sanitized tokens. */
function runSimulatedSanitizedCloudAnalysis(
  sanitizedText: string,
  tokenToSurface: Record<string, string>
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const capMatch = sanitizedText.match(/\[(?:CAP_|CURRENCY_CAP_)[A-Z0-9_]+\]|\b\d+(?:\.\d+)?x\s+Annual\s+Fees/i);
  const exclMatch = sanitizedText.match(/(?:excluding|carve[- ]?out|unlimited)[^.\n]{0,120}/i);
  const firstPartyToken = sanitizedText.match(/\[(?:ORG|PERSON|CODENAME)_[A-Z0-9_]+\]/)?.[0] ?? "[PARTY_1]";

  if (capMatch && exclMatch) {
    const anonExcerpt = `${firstPartyToken} aggregate cap (${capMatch[0]}) vs carve-out "${exclMatch[0].trim()}"`;
    const reh = rehydrateText(anonExcerpt, tokenToSurface);
    findings.push({
      findingId: "SIM-FIND-1",
      severity: "HIGH",
      title: "[SIMULATED_CLOUD_SYNTHESIS] Uncapped Carve-Out Potentially Nullifies Liability Cap",
      clauseRefs: ["Clause 14.1", "Clause 9.3"],
      anonymizedExcerpt: anonExcerpt,
      rehydratedExcerpt: reh.rehydratedText,
      unmappedTokens: reh.unmappedTokens,
      rationale: rehydrateText(
        `Simulated cross-clause synthesizer analyzed ONLY sanitized tokens (${firstPartyToken}, ${capMatch[0]}). The carve-out (${exclMatch[0].trim()}) may expose ${firstPartyToken} above the stated aggregate cap.`,
        tokenToSurface
      ).rehydratedText,
      analysisSource: "SIMULATED_CLOUD_SYNTHESIS",
    });
  } else {
    const anonExcerpt = `${firstPartyToken}: ${sanitizedText.slice(0, 140)}`;
    const reh = rehydrateText(anonExcerpt, tokenToSurface);
    findings.push({
      findingId: "SIM-FIND-BASE",
      severity: "LOW",
      title: "[SIMULATED_CLOUD_SYNTHESIS] Sanitized Document Reviewed (No Cap Contradiction Flagged)",
      clauseRefs: ["General Review"],
      anonymizedExcerpt: anonExcerpt,
      rehydratedExcerpt: reh.rehydratedText,
      unmappedTokens: reh.unmappedTokens,
      rationale: "Simulated cross-clause synthesizer received strictly sanitized placeholders without raw PII.",
      analysisSource: "SIMULATED_CLOUD_SYNTHESIS",
    });
  }
  return findings;
}
