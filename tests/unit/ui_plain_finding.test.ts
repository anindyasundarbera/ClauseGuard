import { describe, expect, it } from "vitest";
import { findingFootText, plainFinding } from "../../src/ui/viewModel.ts";
import type { ContractFinding } from "../../src/core/types.ts";

const base = (over: Partial<ContractFinding>): ContractFinding =>
  ({
    findingId: "X",
    severity: "LOW",
    title: "",
    clauseRefs: [],
    anonymizedExcerpt: "",
    rehydratedExcerpt: "",
    unmappedTokens: [],
    rationale: "",
    analysisSource: "DETERMINISTIC_LOCAL_TRIAGE",
    ...over,
  }) as ContractFinding;

describe("plainFinding", () => {
  it("rewrites the built-in high-risk check in plain words", () => {
    const p = plainFinding(base({ findingId: "LOCAL-TRIAGE-DET-1", severity: "HIGH", title: "Local Deterministic Flag: Uncapped Carve-Out / Exclusion Keyword Detected", rationale: "Nano weights unavailable locally; deterministic check flagged exclusion/unlimited liability language with 0 outbound network requests." }));
    expect(p.title).not.toMatch(/Local|Deterministic|Nano/);
    expect(p.message).not.toMatch(/Nano|deterministic|outbound/i);
  });
  it("rewrites the built-in standard result", () => {
    expect(plainFinding(base({ findingId: "LOCAL-TRIAGE-DET-1", severity: "LOW" })).title).toBe("Nothing unusual stood out");
  });
  it("cleans engine words from other findings", () => {
    const p = plainFinding(base({ title: "On-Device Gemini Nano Clause Triage (Firebase ONLY_ON_DEVICE)", rationale: "the cap may not apply." }));
    expect(p.title).not.toMatch(/Firebase|ONLY_ON_DEVICE|Nano/);
    expect(p.message).toBe("The cap may not apply.");
  });
  it("drops the internal clause label from the foot line", () => {
    expect(findingFootText(base({ clauseRefs: ["Selected Local Clause"] }))).toBe("Checked on this device with built-in rules");
    expect(findingFootText(base({ clauseRefs: ["Clause 9.2"] }))).toBe("Checked on this device with built-in rules · Clause 9.2");
  });
});
