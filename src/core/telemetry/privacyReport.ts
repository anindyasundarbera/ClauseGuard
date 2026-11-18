import type {
  AppCheckStatus,
  DetectedEntity,
  NanoReadinessState,
  NormalizedDocument,
  PrivacyMode,
  PrivacyProcessingAndEgressReport16,
} from "../types.ts";

/** SafeLogger prevents raw document substrings, emails, IBANs, debug tokens, or API keys from appearing in console/errors. */
export const SafeLogger = {
  sanitizeMessage(raw: string): string {
    return raw
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,12}\b/g, "[REDACTED_EMAIL]")
      .replace(/\b(?:sk-[A-Za-z0-9_-]{8,80}|AIza[0-9A-Za-z_-]{10,40}|ghp_[A-Za-z0-9]{10,60})\b/g, "[REDACTED_KEY]")
      .replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b/g, "[REDACTED_IBAN]")
      .replace(/FIREBASE_APPCHECK_DEBUG_TOKEN\s*[:=]\s*["']?[A-Za-z0-9-]{8,64}["']?/gi, "FIREBASE_APPCHECK_DEBUG_TOKEN=[REDACTED]")
      .slice(0, 220);
  },
  info(scope: string, message: string): void {
    console.info(`[ClauseGuard:${scope}] ${this.sanitizeMessage(message)}`);
  },
  warn(scope: string, message: string): void {
    console.warn(`[ClauseGuard:${scope}] ${this.sanitizeMessage(message)}`);
  },
};

export const MANDATORY_NON_CERTIFICATION_DISCLAIMER =
  "TECHNICAL PRIVACY REPORT (NOT LEGAL/REGULATORY CERTIFICATION): SHA-256 digests prove byte equivalence between the reviewed Airlock payload and the payload passed to Firebase AI Logic ONLY_IN_CLOUD at dispatch time; they do not independently certify zero OS-level egress, absence of third-party <all_urls> browser extensions, or GDPR/HIPAA/SOC2 legal compliance. ClauseGuard Hybrid is an assistive risk tool requiring human review, not legal advice.";

export function buildPrivacyProcessingReport16(params: {
  sessionId: string;
  privacyMode: PrivacyMode;
  nanoReadinessState: NanoReadinessState;
  doc: NormalizedDocument | null;
  rawDocumentSha256: string;
  approvedPayloadSha256: string | null;
  redactionMapVersion: number;
  entities: DetectedEntity[];
  localInferenceSource: string;
  cloudInferenceSource: string | null;
  appCheckStatus?: AppCheckStatus;
}): PrivacyProcessingAndEgressReport16 {
  const accepted = params.entities.filter((e) => e.reviewStatus === "ACCEPTED").length;
  const rejected = params.entities.filter((e) => e.reviewStatus === "REJECTED").length;

  return {
    report_id: `PRIV-RPT-${params.sessionId}`,
    generated_at_utc: new Date().toISOString(),
    session_id: params.sessionId,
    privacy_mode: params.privacyMode,
    nano_readiness_state: params.nanoReadinessState,
    raw_document_sha256: params.rawDocumentSha256,
    normalized_document_sha256: params.doc?.normalizedSha256 ?? "NONE",
    approved_payload_sha256: params.approvedPayloadSha256,
    redaction_map_version: params.redactionMapVersion,
    entities_accepted_count: accepted,
    entities_rejected_count: rejected,
    local_inference_source: params.localInferenceSource,
    cloud_inference_source: params.cloudInferenceSource,
    verified_properties: [
      "Raw document parsing, NFKC normalization, deterministic Layer-1 scrubbing, and ARCH-RET-4.1 entity resolution ran inside browser RAM.",
      "PREFER_ON_DEVICE is absent from inference code; local processing uses Firebase AI Logic ONLY_ON_DEVICE and fails closed without raw cloud fallback.",
      `Firebase App Check status: ${params.appCheckStatus ?? "LOCAL_ONLY_NO_CLOUD"}.`,
      params.approvedPayloadSha256
        ? `Cloud submission gated on HUMAN_APPROVED_FOR_CLOUD matching SHA-256 ${params.approvedPayloadSha256.slice(0, 16)}... via Firebase AI Logic ONLY_IN_CLOUD.`
        : "No cloud payload approved or dispatched in this session.",
    ],
    unverified_external_properties: [
      "Browser extensions with <all_urls> host permissions operate outside origin JavaScript control.",
      "OS/kernel-level network inspection requires external CDP/proxy instrumentation (see Phase 6 egress report).",
    ],
    known_limitations_and_non_certification_disclaimer: MANDATORY_NON_CERTIFICATION_DISCLAIMER,
  };
}
