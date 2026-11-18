import type { FirebaseApp } from "firebase/app";
import { fetchAndActivate, getRemoteConfig, getValue } from "firebase/remote-config";
import { PrivacyBoundaryError } from "../errors.ts";
import type { RemoteConfigRuntimeSnapshot, SupportedFirebaseCloudModel } from "../types.ts";
import { DEFAULT_CLOUD_MODEL_ID, validateSupportedCloudModel } from "./firebaseClient.ts";

export interface RawRemoteConfigPayload {
  cloud_model_name?: unknown;
  playbook_id?: unknown;
  max_cloud_output_tokens?: unknown;
  // Security-sensitive fields that MUST NEVER be weakened remotely:
  local_inference_mode?: unknown;
  require_human_airlock_approval?: unknown;
  enable_zero_canary_preflight?: unknown;
  enforce_app_check?: unknown;
}

export const DEFAULT_REMOTE_CONFIG_SNAPSHOT: RemoteConfigRuntimeSnapshot = {
  source: "DEFAULT_LOCAL",
  cloudModelName: DEFAULT_CLOUD_MODEL_ID,
  playbookId: "COMMERCIAL_MSA_CONTRADICTION",
  maxCloudOutputTokens: 2048,
  lastFetchedAtUtc: null,
  safetyInvariantsLocked: true,
};

const ALLOWED_PLAYBOOKS = new Set([
  "COMMERCIAL_MSA_CONTRADICTION",
  "NDA_CARVEOUT_AUDIT",
  "DPA_SUBPROCESSOR_REVIEW",
]);

/**
 * Enforce immutable client-side safety invariants against remote configuration payloads.
 * Remote Config may select a valid Gemini 3+/4 cloud model or playbook for already-sanitized
 * payloads, but can NEVER override ONLY_ON_DEVICE, Airlock consent, ZeroCanaryPreflight, or App Check.
 */
export function enforceRemoteConfigSafetyInvariants(
  raw: RawRemoteConfigPayload
): Omit<RemoteConfigRuntimeSnapshot, "source" | "lastFetchedAtUtc"> {
  if (raw.local_inference_mode !== undefined && raw.local_inference_mode !== "ONLY_ON_DEVICE") {
    throw new PrivacyBoundaryError(
      "ERR_REMOTE_CONFIG_INVARIANT_VIOLATION",
      `Remote Config attempted to weaken local_inference_mode to '${String(raw.local_inference_mode)}'. Only ONLY_ON_DEVICE is permitted.`
    );
  }
  if (raw.require_human_airlock_approval === false || raw.require_human_airlock_approval === "false") {
    throw new PrivacyBoundaryError(
      "ERR_REMOTE_CONFIG_INVARIANT_VIOLATION",
      "Remote Config cannot disable require_human_airlock_approval."
    );
  }
  if (raw.enable_zero_canary_preflight === false || raw.enable_zero_canary_preflight === "false") {
    throw new PrivacyBoundaryError(
      "ERR_REMOTE_CONFIG_INVARIANT_VIOLATION",
      "Remote Config cannot disable enable_zero_canary_preflight."
    );
  }
  if (raw.enforce_app_check === false || raw.enforce_app_check === "false") {
    throw new PrivacyBoundaryError(
      "ERR_REMOTE_CONFIG_INVARIANT_VIOLATION",
      "Remote Config cannot disable enforce_app_check."
    );
  }

  let cloudModelName: SupportedFirebaseCloudModel = DEFAULT_CLOUD_MODEL_ID;
  if (typeof raw.cloud_model_name === "string" && raw.cloud_model_name.trim().length > 0) {
    cloudModelName = validateSupportedCloudModel(raw.cloud_model_name);
  }

  const rawPlaybook = typeof raw.playbook_id === "string" ? raw.playbook_id.trim() : "";
  const playbookId = ALLOWED_PLAYBOOKS.has(rawPlaybook)
    ? rawPlaybook
    : DEFAULT_REMOTE_CONFIG_SNAPSHOT.playbookId;

  let maxCloudOutputTokens = DEFAULT_REMOTE_CONFIG_SNAPSHOT.maxCloudOutputTokens;
  if (raw.max_cloud_output_tokens !== undefined) {
    const parsed = Number(raw.max_cloud_output_tokens);
    if (Number.isFinite(parsed)) {
      maxCloudOutputTokens = Math.min(4096, Math.max(256, Math.round(parsed)));
    }
  }

  return {
    cloudModelName,
    playbookId,
    maxCloudOutputTokens,
    safetyInvariantsLocked: true,
  };
}

/**
 * Fetch and activate non-secret operational parameters from Firebase Remote Config
 * when HYBRID_ANONYMIZED cloud synthesis is explicitly used. Fails safely back to
 * local defaults without weakening safety boundaries.
 */
export async function fetchGuardrailedRemoteConfig(
  cloudApp: FirebaseApp
): Promise<RemoteConfigRuntimeSnapshot> {
  const rc = getRemoteConfig(cloudApp);
  rc.settings = {
    minimumFetchIntervalMillis: 300_000,
    fetchTimeoutMillis: 10_000,
  };
  rc.defaultConfig = {
    cloud_model_name: DEFAULT_REMOTE_CONFIG_SNAPSHOT.cloudModelName,
    playbook_id: DEFAULT_REMOTE_CONFIG_SNAPSHOT.playbookId,
    max_cloud_output_tokens: DEFAULT_REMOTE_CONFIG_SNAPSHOT.maxCloudOutputTokens,
  };

  await fetchAndActivate(rc);
  const rawPayload: RawRemoteConfigPayload = {
    cloud_model_name: getValue(rc, "cloud_model_name").asString(),
    playbook_id: getValue(rc, "playbook_id").asString(),
    max_cloud_output_tokens: getValue(rc, "max_cloud_output_tokens").asNumber(),
    local_inference_mode: getValue(rc, "local_inference_mode").asString() || undefined,
    require_human_airlock_approval: getValue(rc, "require_human_airlock_approval").asString() || undefined,
    enable_zero_canary_preflight: getValue(rc, "enable_zero_canary_preflight").asString() || undefined,
    enforce_app_check: getValue(rc, "enforce_app_check").asString() || undefined,
  };

  const validated = enforceRemoteConfigSafetyInvariants(rawPayload);
  return {
    source: "FIREBASE_REMOTE_CONFIG",
    ...validated,
    lastFetchedAtUtc: new Date().toISOString(),
  };
}
