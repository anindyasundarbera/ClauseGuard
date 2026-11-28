import { describe, expect, it } from "vitest";
import { classifyRequest, describeEgress, shortSha } from "../../src/ui/egress.ts";

const ORIGIN = "https://clauseguard-hybrid-1c5e2.web.app";

describe("classifyRequest", () => {
  it("ignores the app's own files and data URLs", () => {
    expect(classifyRequest(`${ORIGIN}/assets/app.js`, ORIGIN)).toBeNull();
    expect(classifyRequest("/guide.html", ORIGIN)).toBeNull();
    expect(classifyRequest("data:text/plain,hi", ORIGIN)).toBeNull();
  });
  it("counts the Firebase AI Logic generateContent call as cloud AI", () => {
    expect(
      classifyRequest(
        "https://firebasevertexai.googleapis.com/v1beta/projects/p/models/gemini-3.5-flash-lite:generateContent",
        ORIGIN
      )
    ).toBe("ai");
    expect(classifyRequest("https://example.org/v1/models/x:streamGenerateContent", ORIGIN)).toBe("ai");
  });
  it("labels App Check, Remote Config and reCAPTCHA as support", () => {
    expect(classifyRequest("https://content-firebaseappcheck.googleapis.com/v1/x:exchangeRecaptchaEnterpriseToken", ORIGIN)).toBe("support");
    expect(classifyRequest("https://firebaseremoteconfig.googleapis.com/v1/projects/p/namespaces/firebase:fetch", ORIGIN)).toBe("support");
    expect(classifyRequest("https://www.google.com/recaptcha/enterprise.js", ORIGIN)).toBe("support");
  });
  it("anything else is other", () => {
    expect(classifyRequest("https://cdn.example.net/x.js", ORIGIN)).toBe("other");
  });
});

describe("describeEgress", () => {
  const zero = { ai: 0, support: 0, other: 0 };
  it("before approval says nothing is sent", () => {
    const v = describeEgress({ counts: zero, cloudSource: null, approvedSha: null, localSource: null });
    expect(v.aiCount).toBe(0);
    expect(v.label).toBe("requests to cloud AI");
    expect(v.detail).toMatch(/until you approve/);
    expect(v.others).toBeNull();
  });
  it("practice mode says nothing was sent", () => {
    const v = describeEgress({ counts: zero, cloudSource: "SIMULATED_CLOUD_SYNTHESIS", approvedSha: "abc", localSource: "rules" });
    expect(v.detail).toMatch(/Practice mode/);
    expect(v.readingOn).toMatch(/built-in rules/);
  });
  it("after one cloud call names the approved fingerprint", () => {
    const sha = "a3f9000000000000000000000000000000000000000000000000000000c1c1";
    const v = describeEgress({ counts: { ai: 1, support: 2, other: 0 }, cloudSource: "in_cloud", approvedSha: sha, localSource: "on_device" });
    expect(v.label).toBe("request to cloud AI");
    expect(v.detail).toContain(shortSha(sha));
    expect(v.readingOn).toMatch(/Gemini Nano/);
    expect(v.others).toMatch(/2 for app settings and the security check/);
    expect(v.others).toMatch(/never include your document/);
  });
  it("unknown hosts point to the browser's Network tools", () => {
    const v = describeEgress({ counts: { ai: 0, support: 0, other: 1 }, cloudSource: null, approvedSha: null, localSource: null });
    expect(v.others).toMatch(/Network tools/);
  });
});
