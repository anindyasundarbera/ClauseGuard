import { sha256Hex } from "../ingestion/normalizer.ts";
import { rehydrateText } from "../redaction/redactor.ts";
import type {
  ApprovalState,
  CloudInferenceMode,
  ContractFinding,
  HumanApprovedPayload,
  RedactionResult,
} from "../types.ts";

export class PrivacyBoundaryError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "PrivacyBoundaryError";
  }
}

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
  cloudEndpointUrl?: string;
  geminiApiKey?: string;
  modelId?: string;
  cloudMode: CloudInferenceMode;
  allowLocalSimulatedCloud?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Analyze the exact human-approved sanitized payload via ONLY_IN_CLOUD.
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

  // Path 1: Custom cloud endpoint (used in Playwright CDP test or proxy backend)
  if (opts.cloudEndpointUrl) {
    const fn = opts.fetchImpl ?? fetch;
    const res = await fn(opts.cloudEndpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payloadSha256: approval.approvedPayloadSha256,
        sanitizedPayload: sanitizedText,
        playbook: "COMMERCIAL_MSA_CONTRADICTION",
      }),
    });
    if (!res.ok) {
      throw new PrivacyBoundaryError("ERR_CLOUD_HTTP", `Cloud endpoint returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as { findings?: Array<Partial<ContractFinding>> };
    return (json.findings ?? []).map((f, idx) => {
      const anon = f.anonymizedExcerpt ?? sanitizedText.slice(0, 180);
      const reh = rehydrateText(anon, currentRedaction.tokenToSurface);
      return {
        findingId: f.findingId ?? `CLD-${idx + 1}`,
        severity: f.severity ?? "HIGH",
        title: f.title ?? "Cross-Clause Cloud Risk Finding",
        clauseRefs: f.clauseRefs ?? ["Cloud Analysis"],
        anonymizedExcerpt: anon,
        rehydratedExcerpt: reh.rehydratedText,
        unmappedTokens: reh.unmappedTokens,
        rationale: rehydrateText(f.rationale ?? "", currentRedaction.tokenToSurface).rehydratedText,
        analysisSource: "ONLY_IN_CLOUD_GEMINI",
      };
    });
  }

  // Path 2: Direct Google Gemini Developer API (if user explicitly supplied an API key)
  if (opts.geminiApiKey) {
    const model = opts.modelId ?? "gemini-2.5-flash";
    const fn = opts.fetchImpl ?? fetch;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": opts.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analyze this sanitized contract for cross-clause liability caps, carve-outs, or contradictory definitions. Preserve exact bracketed placeholders like [ORG_CLIENT_1] verbatim. Return JSON {findings:[{severity:'HIGH'|'MEDIUM'|'LOW', title, clauseRefs:string[], anonymizedExcerpt, rationale}]}.\n\n${sanitizedText}`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) {
      throw new PrivacyBoundaryError("ERR_GEMINI_API", `Gemini API failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawTxt = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"findings":[]}';
    const parsed = JSON.parse(rawTxt) as { findings?: Array<Partial<ContractFinding>> };
    return (parsed.findings ?? []).map((f, idx) => {
      const anon = f.anonymizedExcerpt ?? "";
      const reh = rehydrateText(anon, currentRedaction.tokenToSurface);
      return {
        findingId: `GEMINI-${idx + 1}`,
        severity: f.severity ?? "MEDIUM",
        title: f.title ?? "Cross-Clause Finding",
        clauseRefs: f.clauseRefs ?? [],
        anonymizedExcerpt: anon,
        rehydratedExcerpt: reh.rehydratedText,
        unmappedTokens: reh.unmappedTokens,
        rationale: rehydrateText(f.rationale ?? "", currentRedaction.tokenToSurface).rehydratedText,
        analysisSource: "ONLY_IN_CLOUD_GEMINI",
      };
    });
  }

  // Path 3: Explicitly labeled local simulated cloud cross-clause analyzer (0 external packets)
  if (!opts.allowLocalSimulatedCloud) {
    throw new PrivacyBoundaryError(
      "ERR_NO_CLOUD_ENDPOINT",
      "No cloud API key or endpoint configured. Enable simulated synthesis mode or provide a Gemini API key."
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
