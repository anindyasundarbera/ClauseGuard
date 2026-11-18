/**
 * Core domain contracts & strict privacy boundary types for ClauseGuard Hybrid.
 * Note: PREFER_ON_DEVICE is intentionally absent from all inference unions so
 * raw document text can never silently fall back to cloud endpoints.
 */

export type LocalInferenceMode = "ONLY_ON_DEVICE";
export type CloudInferenceMode = "ONLY_IN_CLOUD";

export type SupportedFirebaseCloudModel =
  | "gemini-3.5-flash-lite"
  | "gemini-3.8-flash"
  | "gemini-4-hydrogen";

export type PrivacyMode =
  | "LOCAL_ONLY"
  | "HYBRID_ANONYMIZED"
  | "DEGRADED_DETERMINISTIC_SAFE";

export type EntityCategory =
  | "ORG"
  | "PERSON"
  | "CODENAME"
  | "BANK"
  | "EMAIL"
  | "PHONE"
  | "IBAN"
  | "CREDIT_CARD"
  | "SSN"
  | "EIN"
  | "API_KEY"
  | "CURRENCY_CAP"
  | "ADDRESS";

export type ContractRole =
  | "CLIENT"
  | "VENDOR"
  | "BUYER"
  | "TARGET"
  | "DISCLOSING_PARTY"
  | "RECEIVING_PARTY"
  | "ADVISOR"
  | "BANK"
  | "SIGNATORY"
  | "SUBPROCESSOR"
  | "PARTY";

export type DetectionSource =
  | "DETERMINISTIC_L1"
  | "WORKSPACE_GRAPH"
  | "PREAMBLE_DEFINITION"
  | "TRIGRAM_FUZZY"
  | "NANO_ON_DEVICE"
  | "HUMAN_ADDED";

export type ReviewStatus = "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "NEEDS_DECISION";

export type NanoReadinessState =
  | "CHECKING"
  | "READY_ON_DEVICE"
  | "DOWNLOADABLE_PENDING_WEIGHTS"
  | "DOWNLOADING"
  | "UNAVAILABLE"
  | "DISABLED"
  | "DEGRADED_DETERMINISTIC_SAFE"
  | "OFFLINE"
  | "ERROR";

export type ApprovalState =
  | "EMPTY"
  | "RAW_INGESTED"
  | "DETECTED"
  | "IN_REVIEW"
  | "PAYLOAD_PREVIEWED"
  | "HUMAN_APPROVED_FOR_CLOUD"
  | "STALE_APPROVAL_INVALIDATED"
  | "CLOUD_ANALYZED"
  | "REHYDRATED";

export type AppCheckStatus =
  | "NOT_INITIALIZED"
  | "LOCAL_ONLY_NO_CLOUD"
  | "DEBUG_PROVIDER_READY"
  | "RECAPTCHA_ENTERPRISE_READY"
  | "CUSTOM_PROVIDER_READY"
  | "ATTESTATION_FAILED";

export interface FirebaseRuntimeConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  recaptchaEnterpriseSiteKey?: string;
  debugAppCheckToken?: boolean | string;
  useLimitedUseAppCheckTokens?: boolean;
  cloudModelId?: string;
  firebaseBaseUrl?: string;
  customAppCheckTokenProvider?: () => Promise<{ token: string; expireTimeMillis: number }>;
}

export interface RemoteConfigRuntimeSnapshot {
  source: "DEFAULT_LOCAL" | "FIREBASE_REMOTE_CONFIG";
  cloudModelName: SupportedFirebaseCloudModel;
  playbookId: string;
  maxCloudOutputTokens: number;
  lastFetchedAtUtc: string | null;
  safetyInvariantsLocked: true;
}

export interface ObservedFirebaseTelemetry {
  sdkVersion: string;
  hasLiveCloudConfig: boolean;
  appCheckStatus: AppCheckStatus;
  initSequence: string[];
  lastLocalInferenceSource: "on_device" | "DEGRADED_DETERMINISTIC_SAFE" | null;
  lastCloudInferenceSource: "in_cloud" | "SIMULATED_CLOUD_SYNTHESIS" | null;
  activeCloudModel: SupportedFirebaseCloudModel;
  downloadProgressPct: number | null;
  remoteConfig: RemoteConfigRuntimeSnapshot;
}

export interface SourceMapSegment {
  normStart: number;
  normEnd: number;
  origStart: number;
  origEnd: number;
  page: number;
  sectionLabel: string;
}

export interface NormalizedDocument {
  docId: string;
  fileName: string;
  mimeType: string;
  rawCharCount: number;
  normalizedText: string;
  normalizedSha256: string;
  strippedInvisibleCount: number;
  homoglyphWarnings: string[];
  hiddenTextWarnings: string[];
  metadataStripped: boolean;
  pageCount: number;
  scannedPages: number[];
  sourceMap: SourceMapSegment[];
}

export interface DetectedEntity {
  id: string;
  surface: string;
  canonicalKey: string;
  canonicalName: string;
  category: EntityCategory;
  role: ContractRole;
  normStart: number;
  normEnd: number;
  source: DetectionSource;
  confidence: number;
  rationale: string;
  reviewStatus: ReviewStatus;
  needsDecisionReason?: string;
}

export interface CanonicalEntity {
  canonicalId: string;
  canonicalName: string;
  category: Exclude<
    EntityCategory,
    "IBAN" | "CREDIT_CARD" | "SSN" | "EIN" | "API_KEY" | "CURRENCY_CAP" | "EMAIL" | "PHONE" | "ADDRESS"
  >;
  aliases: string[];
  trustState: "HUMAN_APPROVED" | "DETERMINISTIC_SEED";
  updatedAtUtc: string;
}

export interface DocumentEntityBinding {
  docSessionId: string;
  canonicalId: string;
  localRole: ContractRole;
  localDefinedAliases: string[];
}

export interface RedactionMapEntry {
  token: string;
  baseToken: string;
  variantIndex: number;
  canonicalKey: string;
  originalSurface: string;
  category: EntityCategory;
  role: ContractRole;
  normStart: number;
  normEnd: number;
}

export interface RedactionResult {
  sanitizedText: string;
  sanitizedSha256: string;
  entries: RedactionMapEntry[];
  tokenToSurface: Record<string, string>;
  mapVersion: number;
}

export interface TextChunk {
  chunkIndex: number;
  normStart: number;
  normEnd: number;
  text: string;
  conservativeTokens: number;
}

export interface NanoChunkResult {
  chunkIndex: number;
  inferenceSource: "FIREBASE_AI_LOGIC_ON_DEVICE" | "DEGRADED_DETERMINISTIC_SAFE";
  sdkInferenceSource?: "on_device";
  verifiedEntities: Array<{
    surface: string;
    category: EntityCategory;
    confidence: number;
    normStart: number;
    normEnd: number;
  }>;
  suspiciousZeroDetection: boolean;
  unverifiedManualReview: boolean;
  warning?: string;
}

export interface ContractFinding {
  findingId: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  clauseRefs: string[];
  anonymizedExcerpt: string;
  rehydratedExcerpt: string;
  unmappedTokens: string[];
  rationale: string;
  analysisSource:
    | "FIREBASE_AI_LOGIC_ONLY_IN_CLOUD"
    | "SIMULATED_CLOUD_SYNTHESIS"
    | "FIREBASE_AI_LOGIC_ONLY_ON_DEVICE_TRIAGE"
    | "DETERMINISTIC_LOCAL_TRIAGE";
  observedInferenceSource?: "on_device" | "in_cloud";
  modelUsed?: string;
}

/** 16-field PrivacyProcessingAndEgressReport matching IFC v3.0.0 + Section 16 disclaimer */
export interface PrivacyProcessingAndEgressReport16 {
  report_id: string;
  generated_at_utc: string;
  session_id: string;
  privacy_mode: PrivacyMode;
  nano_readiness_state: NanoReadinessState;
  raw_document_sha256: string;
  normalized_document_sha256: string;
  approved_payload_sha256: string | null;
  redaction_map_version: number;
  entities_accepted_count: number;
  entities_rejected_count: number;
  local_inference_source: string;
  cloud_inference_source: string | null;
  verified_properties: string[];
  unverified_external_properties: string[];
  known_limitations_and_non_certification_disclaimer: string;
}

export interface WorkspaceVaultSnapshot {
  version: 1;
  workspaceId: string;
  canonicalEntities: CanonicalEntity[];
  rejectionAllowlist: string[];
  updatedAtUtc: string;
}

export type HumanApprovedPayload = string & { readonly __brand: "HumanApprovedAnonymizedPayload" };
