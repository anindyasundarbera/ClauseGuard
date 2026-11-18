import {
  deleteApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import {
  CustomProvider,
  getToken as fetchAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
  type AI,
  type GenerativeModel,
  type RequestOptions,
} from "firebase/ai";
import { PrivacyBoundaryError } from "../errors.ts";
import type {
  AppCheckStatus,
  FirebaseRuntimeConfig,
  SupportedFirebaseCloudModel,
} from "../types.ts";

export const CLAUSEGUARD_FIREBASE_SDK_VERSION = "firebase@13.4.0 / @firebase/ai@3.1.0";
export const DEFAULT_CLOUD_MODEL_ID: SupportedFirebaseCloudModel = "gemini-3.5-flash-lite";
export const SUPPORTED_FIREBASE_CLOUD_MODELS: readonly SupportedFirebaseCloudModel[] = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-4-hydrogen",
] as const;

const LOCAL_ONLY_APP_NAME = "clauseguard-local-only";
const CLOUD_APP_NAME = "clauseguard-cloud";
const LOCAL_PLACEHOLDER_PREFIX = "clauseguard-local-only";

export const ENTITY_EXTRACTION_FIREBASE_SCHEMA = Schema.array({
  items: Schema.object({
    properties: {
      v: Schema.string(),
      t: Schema.enumString({ enum: ["ORG", "PERSON", "CODENAME", "ADDRESS"] }),
      c: Schema.number(),
    },
  }),
});

export const CLOUD_FINDINGS_FIREBASE_SCHEMA = Schema.object({
  properties: {
    findings: Schema.array({
      items: Schema.object({
        properties: {
          severity: Schema.enumString({ enum: ["HIGH", "MEDIUM", "LOW"] }),
          title: Schema.string(),
          clauseRefs: Schema.array({ items: Schema.string() }),
          anonymizedExcerpt: Schema.string(),
          rationale: Schema.string(),
        },
      }),
    }),
  },
});

export const CLOUD_RISK_SYSTEM_INSTRUCTION =
  "You are a contract risk analyst receiving strictly anonymized contract text where party names, addresses, and account numbers are replaced with bracketed tokens like [ORG_CLIENT_1] or [CAP_1M_PLUS_1]. Identify cross-clause contradictions (for example, aggregate liability caps undercut by uncapped carve-outs or conflicting party duties). Preserve every bracketed placeholder verbatim without guessing hidden identities. Return valid JSON matching the schema.";

export function validateSupportedCloudModel(modelId: string): SupportedFirebaseCloudModel {
  const trimmed = modelId.trim();
  if (/^gemini-(?:1|2)\./i.test(trimmed)) {
    throw new PrivacyBoundaryError(
      "ERR_DEPRECATED_GEMINI_MODEL",
      `Model '${trimmed}' belongs to legacy Gemini 1.x/2.x series shut down in Firebase AI Logic docs. Use one of: ${SUPPORTED_FIREBASE_CLOUD_MODELS.join(", ")}.`
    );
  }
  if ((SUPPORTED_FIREBASE_CLOUD_MODELS as readonly string[]).includes(trimmed)) {
    return trimmed as SupportedFirebaseCloudModel;
  }
  throw new PrivacyBoundaryError(
    "ERR_UNSUPPORTED_CLOUD_MODEL",
    `Unsupported cloud model '${trimmed}'. Allowed free-tier Gemini models: ${SUPPORTED_FIREBASE_CLOUD_MODELS.join(", ")}.`
  );
}

export function isLiveFirebaseConfig(config?: Partial<FirebaseRuntimeConfig> | null): config is FirebaseRuntimeConfig {
  if (!config) return false;
  return Boolean(
    config.apiKey &&
      config.projectId &&
      config.appId &&
      !config.projectId.startsWith(LOCAL_PLACEHOLDER_PREFIX) &&
      !config.apiKey.startsWith("local-only-")
  );
}

export function readFirebaseEnvConfig(): Partial<FirebaseRuntimeConfig> | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.MODE === "test") {
    return null;
  }
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = env.VITE_FIREBASE_APP_ID?.trim();
  if (!apiKey || !projectId || !appId) {
    return null;
  }
  const rawDebug = env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();
  const debugToken: boolean | string | undefined =
    rawDebug === "true" ? true : rawDebug && rawDebug.length > 0 ? rawDebug : undefined;

  return {
    apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
    appId,
    recaptchaEnterpriseSiteKey: env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() || undefined,
    debugAppCheckToken: debugToken,
    useLimitedUseAppCheckTokens: env.VITE_FIREBASE_USE_LIMITED_USE_APPCHECK === "true",
    cloudModelId: env.VITE_FIREBASE_CLOUD_MODEL?.trim() || DEFAULT_CLOUD_MODEL_ID,
  };
}

function isLocalhostContext(): boolean {
  if (typeof location === "undefined") return true;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function getOrCreateNamedApp(name: string, options: FirebaseOptions): FirebaseApp {
  const existing = getApps().find((a) => a.name === name);
  if (existing) {
    return existing;
  }
  return initializeApp(options, name);
}

/**
 * Isolated local-only Firebase AI Logic runtime for ONLY_ON_DEVICE calls.
 * Never activates App Check network exchange or cloud endpoints.
 */
export function getLocalOnlyFirebaseAI(config?: Partial<FirebaseRuntimeConfig> | null): AI {
  const options: FirebaseOptions = isLiveFirebaseConfig(config)
    ? {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      }
    : {
        apiKey: "local-only-no-cloud-egress",
        projectId: LOCAL_PLACEHOLDER_PREFIX,
        appId: "1:000000000000:web:localonly",
      };

  const app = getOrCreateNamedApp(LOCAL_ONLY_APP_NAME, options);
  return getAI(app, { backend: new GoogleAIBackend() });
}

const entityModelCache = new WeakMap<AI, { lmRef: unknown; model: GenerativeModel }>();

export function createOnDeviceEntityModel(
  ai: AI,
  systemPrompt: string,
  onDownloadMonitor?: (monitor: {
    addEventListener: (
      eventType: "downloadprogress",
      listener: (e: { loaded: number }) => void
    ) => void;
    removeEventListener: (
      eventType: "downloadprogress",
      listener: (e: { loaded: number }) => void
    ) => void;
  }) => void
): GenerativeModel {
  const currentLm = (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
  if (!onDownloadMonitor && currentLm) {
    const hit = entityModelCache.get(ai);
    if (hit && hit.lmRef === currentLm) {
      return hit.model;
    }
  }
  const model = getGenerativeModel(
    ai,
    {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: systemPrompt }],
            },
          ],
          ...(onDownloadMonitor ? { monitor: onDownloadMonitor } : {}),
        },
        promptOptions: {
          responseConstraint: ENTITY_EXTRACTION_FIREBASE_SCHEMA as unknown as object,
        },
      },
    },
    { baseUrl: "http://127.0.0.1:0/only-on-device-cloud-egress-blocked" }
  );
  if (!onDownloadMonitor && currentLm) {
    entityModelCache.set(ai, { lmRef: currentLm, model });
  }
  return model;
}

export function createOnDeviceTriageModel(ai: AI, systemPrompt: string): GenerativeModel {
  return getGenerativeModel(
    ai,
    {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: systemPrompt }],
            },
          ],
        },
      },
    },
    { baseUrl: "http://127.0.0.1:0/only-on-device-cloud-egress-blocked" }
  );
}

export interface CloudFirebaseRuntimeHandle {
  app: FirebaseApp;
  appCheck: AppCheck;
  ai: AI;
  appCheckStatus: AppCheckStatus;
  initSequence: string[];
  createCloudModel: (modelId?: string, requestOptions?: RequestOptions) => GenerativeModel;
  verifyAppCheckAttestation: () => Promise<{ ok: boolean; tokenPresent: boolean; detail: string }>;
}

let cachedCloudKey = "";
let cachedCustomProviderRef: unknown = undefined;
let cachedCloudHandle: CloudFirebaseRuntimeHandle | null = null;

export async function resetCloudFirebaseRuntime(): Promise<void> {
  cachedCloudKey = "";
  cachedCustomProviderRef = undefined;
  cachedCloudHandle = null;
  const existing = getApps().find((a) => a.name === CLOUD_APP_NAME);
  if (existing) {
    await deleteApp(existing);
  }
}

/**
 * Lazily initialize the dedicated cloud FirebaseApp -> App Check -> AI Logic stack.
 * Guarantees App Check is initialized strictly BEFORE getAI(), with zero boot-time pings
 * when running in LOCAL_ONLY mode.
 */
export async function ensureCloudFirebaseRuntime(
  config: FirebaseRuntimeConfig
): Promise<CloudFirebaseRuntimeHandle> {
  if (!isLiveFirebaseConfig(config)) {
    throw new PrivacyBoundaryError(
      "ERR_FIREBASE_CONFIG_MISSING",
      "Valid Firebase Web configuration (apiKey, projectId, appId) is required for live cloud inference."
    );
  }

  const fingerprint = JSON.stringify({
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId,
    siteKey: config.recaptchaEnterpriseSiteKey ?? "",
    debug: config.debugAppCheckToken ?? false,
    limited: Boolean(config.useLimitedUseAppCheckTokens),
    hasCustom: Boolean(config.customAppCheckTokenProvider),
  });
  if (
    cachedCloudHandle &&
    cachedCloudKey === fingerprint &&
    cachedCustomProviderRef === config.customAppCheckTokenProvider
  ) {
    return cachedCloudHandle;
  }

  if (cachedCloudHandle) {
    await resetCloudFirebaseRuntime();
  }

  const initSequence: string[] = [];
  const cloudApp = getOrCreateNamedApp(CLOUD_APP_NAME, {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  initSequence.push("initializeApp");

  let appCheckStatus: AppCheckStatus = "NOT_INITIALIZED";
  let provider;

  if (config.customAppCheckTokenProvider) {
    provider = new CustomProvider({ getToken: config.customAppCheckTokenProvider });
    appCheckStatus = "CUSTOM_PROVIDER_READY";
  } else if (config.debugAppCheckToken !== undefined && config.debugAppCheckToken !== false) {
    if (!isLocalhostContext()) {
      throw new PrivacyBoundaryError(
        "ERR_APP_CHECK_DEBUG_FORBIDDEN_ORIGIN",
        "App Check debug tokens are strictly restricted to localhost / 127.0.0.1 development contexts."
      );
    }
    (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      config.debugAppCheckToken;
    provider = config.recaptchaEnterpriseSiteKey
      ? new ReCaptchaEnterpriseProvider(config.recaptchaEnterpriseSiteKey)
      : new CustomProvider({
          getToken: async () => ({ token: "", expireTimeMillis: 0 }),
        });
    appCheckStatus = "DEBUG_PROVIDER_READY";
  } else if (config.recaptchaEnterpriseSiteKey) {
    provider = new ReCaptchaEnterpriseProvider(config.recaptchaEnterpriseSiteKey);
    appCheckStatus = "RECAPTCHA_ENTERPRISE_READY";
  } else {
    throw new PrivacyBoundaryError(
      "ERR_APP_CHECK_NOT_CONFIGURED",
      "Firebase App Check requires either a reCAPTCHA Enterprise site key (production) or localhost debug token before ONLY_IN_CLOUD calls."
    );
  }

  const appCheck = initializeAppCheck(cloudApp, {
    provider,
    isTokenAutoRefreshEnabled: false,
  });
  initSequence.push("initializeAppCheck");

  const ai = getAI(cloudApp, {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: Boolean(config.useLimitedUseAppCheckTokens),
  });
  initSequence.push("getAI");

  const handle: CloudFirebaseRuntimeHandle = {
    app: cloudApp,
    appCheck,
    ai,
    appCheckStatus,
    initSequence,
    createCloudModel(modelId = config.cloudModelId ?? DEFAULT_CLOUD_MODEL_ID, requestOptions?: RequestOptions) {
      const validatedModel = validateSupportedCloudModel(modelId);
      if (!initSequence.includes("getGenerativeModel(ONLY_IN_CLOUD)")) {
        initSequence.push("getGenerativeModel(ONLY_IN_CLOUD)");
      }
      return getGenerativeModel(
        ai,
        {
          mode: InferenceMode.ONLY_IN_CLOUD,
          inCloudParams: {
            model: validatedModel,
            systemInstruction: CLOUD_RISK_SYSTEM_INSTRUCTION,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: CLOUD_FINDINGS_FIREBASE_SCHEMA,
              maxOutputTokens: 2048,
            },
          },
        },
        requestOptions ?? (config.firebaseBaseUrl ? { baseUrl: config.firebaseBaseUrl } : undefined)
      );
    },
    async verifyAppCheckAttestation() {
      try {
        const res = (await fetchAppCheckToken(appCheck, false)) as {
          token?: string;
          error?: unknown;
        };
        if (res?.error) {
          return {
            ok: false,
            tokenPresent: false,
            detail: `App Check attestation error: ${String(res.error)}`,
          };
        }
        const tokenPresent = Boolean(res?.token && res.token.length > 0);
        if (!tokenPresent) {
          return {
            ok: false,
            tokenPresent: false,
            detail: "App Check returned an empty attestation token.",
          };
        }
        return {
          ok: true,
          tokenPresent: true,
          detail: `App Check token ready via ${appCheckStatus}.`,
        };
      } catch (err) {
        return {
          ok: false,
          tokenPresent: false,
          detail: `App Check attestation error: ${String(err)}`,
        };
      }
    },
  };

  cachedCloudKey = fingerprint;
  cachedCustomProviderRef = config.customAppCheckTokenProvider;
  cachedCloudHandle = handle;
  return handle;
}

export { InferenceMode, InferenceSource };
