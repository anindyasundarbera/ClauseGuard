import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAppCheckStatus, DEFAULT_PUBLIC_FIREBASE_WEB_CONFIG } from "../../src/core/firebase/firebaseClient.ts";
import {
  DEFAULT_REMOTE_CONFIG_SNAPSHOT,
  enforceRemoteConfigSafetyInvariants,
} from "../../src/core/firebase/remoteConfigGuard.ts";
import {
  ON_DEVICE_CONTEXT_TOKEN_BUDGET,
  WORST_CASE_ON_DEVICE_CALL_TOKENS,
} from "../../src/core/orchestration/nanoAdapter.ts";

// A fake but structurally live config: the committed default is an empty template.
const live = {
  ...DEFAULT_PUBLIC_FIREBASE_WEB_CONFIG,
  apiKey: "test-web-api-key",
  projectId: "test-project",
  appId: "1:000000000000:web:test",
};

describe("App Check status honesty", () => {
  it("never reports NOT_INITIALIZED for a configured provider", () => {
    expect(resolveAppCheckStatus({ ...live, recaptchaEnterpriseSiteKey: "k" })).toBe("RECAPTCHA_ENTERPRISE_READY");
    expect(resolveAppCheckStatus({ ...live, debugAppCheckToken: true })).toBe("DEBUG_PROVIDER_READY");
    expect(
      resolveAppCheckStatus({ ...live, customAppCheckTokenProvider: async () => ({ token: "t", expireTimeMillis: 1 }) })
    ).toBe("CUSTOM_PROVIDER_READY");
  });
  it("reports NOT_CONFIGURED (not a stuck NOT_INITIALIZED) when nothing is configured", () => {
    expect(resolveAppCheckStatus(live)).toBe("NOT_CONFIGURED");
  });
  it("reports LOCAL_ONLY_NO_CLOUD without a live config", () => {
    expect(resolveAppCheckStatus(null)).toBe("LOCAL_ONLY_NO_CLOUD");
    expect(resolveAppCheckStatus({})).toBe("LOCAL_ONLY_NO_CLOUD");
  });
});

describe("Remote Config template", () => {
  const tpl = JSON.parse(readFileSync("remoteconfig.template.json", "utf8")) as {
    parameters: Record<string, { defaultValue: { value: string } }>;
  };
  it("contains exactly the guarded keys and no security-sensitive keys", () => {
    expect(Object.keys(tpl.parameters).sort()).toEqual(["cloud_model_name", "max_cloud_output_tokens", "playbook_id"]);
  });
  it("defaults pass the guard and match the in-code defaults", () => {
    const p = tpl.parameters;
    const out = enforceRemoteConfigSafetyInvariants({
      cloud_model_name: p.cloud_model_name.defaultValue.value,
      playbook_id: p.playbook_id.defaultValue.value,
      max_cloud_output_tokens: Number(p.max_cloud_output_tokens.defaultValue.value),
    });
    expect(out.cloudModelName).toBe(DEFAULT_REMOTE_CONFIG_SNAPSHOT.cloudModelName);
    expect(out.playbookId).toBe(DEFAULT_REMOTE_CONFIG_SNAPSHOT.playbookId);
    expect(out.maxCloudOutputTokens).toBe(DEFAULT_REMOTE_CONFIG_SNAPSHOT.maxCloudOutputTokens);
  });
  it("firebase.json points at the template", () => {
    expect(JSON.parse(readFileSync("firebase.json", "utf8")).remoteconfig.template).toBe("remoteconfig.template.json");
  });
});

describe("Remote Config guard edge cases", () => {
  it("rejects string-false overrides and a deprecated model", () => {
    expect(() => enforceRemoteConfigSafetyInvariants({ require_human_airlock_approval: "false" })).toThrow(
      /ERR_REMOTE_CONFIG_INVARIANT_VIOLATION/
    );
    expect(() => enforceRemoteConfigSafetyInvariants({ cloud_model_name: "gemini-2.0-flash" })).toThrow(
      /ERR_DEPRECATED_GEMINI_MODEL/
    );
  });
  it("clamps token floor and ignores unknown playbooks", () => {
    const r = enforceRemoteConfigSafetyInvariants({ max_cloud_output_tokens: 1, playbook_id: "EVIL" });
    expect(r.maxCloudOutputTokens).toBe(256);
    expect(r.playbookId).toBe(DEFAULT_REMOTE_CONFIG_SNAPSHOT.playbookId);
  });
});

describe("On-device budget", () => {
  it("worst-case call fits the 9,216-token on-device window", () => {
    expect(ON_DEVICE_CONTEXT_TOKEN_BUDGET).toBe(9216);
    expect(WORST_CASE_ON_DEVICE_CALL_TOKENS).toBeLessThan(ON_DEVICE_CONTEXT_TOKEN_BUDGET);
  });
});
