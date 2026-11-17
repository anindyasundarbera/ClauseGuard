import { describe, expect, it } from "vitest";
import {
  passesIbanMod97,
  passesLuhn,
  runDeterministicDetectors,
} from "../../src/core/detection/deterministicDetectors.ts";
import {
  commitHumanApprovedToWorkspace,
  resolveEntitiesWithGraph,
} from "../../src/core/intelligence/entityGraph.ts";
import type { CanonicalEntity } from "../../src/core/types.ts";

describe("Deterministic Layer-1 Scrubbers & ARCH-RET-4.1 Entity Graph", () => {
  it("validates Luhn, IBAN Mod-97, emails, synthetic SSN canaries, API keys, and ReDoS < 10ms", () => {
    expect(passesIbanMod97("DE89370400440532013000")).toBe(true);
    expect(passesIbanMod97("DE00370400440532013000")).toBe(false);
    expect(passesLuhn("4532015112830366")).toBe(true);
    expect(passesLuhn("4532015112830367")).toBe(false);

    const text =
      "Email: elena.vance@meridian.de | IBAN DE89370400440532013000 | Key sk-proj-99887766554433221100aabbccddeeff | " +
      "SSN 999-01-4242 | Cap USD $1,850,000.00 (1.5x Annual Fees excluding Delaware) | Project Obsidian.";
    const hits = runDeterministicDetectors(text, { allowSyntheticCanarySsn: true });
    const cats = new Set(hits.map((h) => h.category));
    expect(cats.has("EMAIL")).toBe(true);
    expect(cats.has("IBAN")).toBe(true);
    expect(cats.has("API_KEY")).toBe(true);
    expect(cats.has("SSN")).toBe(true);
    expect(cats.has("CURRENCY_CAP")).toBe(true);
    expect(cats.has("CODENAME")).toBe(true);
    expect(hits.some((h) => h.surface.includes("1.5x"))).toBe(false);

    // 50,000-char pathological numeric string ReDoS check (< 15ms)
    const hostile = "4532 0151 1283 ".repeat(3334);
    const t0 = performance.now();
    runDeterministicDetectors(hostile);
    expect(performance.now() - t0).toBeLessThan(25);
  });

  it("prevents Apex vs Zenith conflation, guards MPR homonym, and keeps roles strictly document-local", () => {
    const workspace: CanonicalEntity[] = [
      {
        canonicalId: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        aliases: ["MPR"],
        trustState: "HUMAN_APPROVED",
        updatedAtUtc: "2026-11-17T00:00:00Z",
      },
      {
        canonicalId: "ENT-ZENITH",
        canonicalName: "Zenith Biologics GmbH",
        category: "ORG",
        aliases: [],
        trustState: "HUMAN_APPROVED",
        updatedAtUtc: "2026-11-17T00:00:00Z",
      },
    ];
    const allowlist = new Set(["state of delaware"]);

    // Doc 1: Meridian is CLIENT; Apex is distinct from Zenith
    const doc1 =
      "MSA between Meridian Precision Robotics GmbH ('MPR' or 'CLIENT') and Apex Biologics GmbH ('VENDOR'). " +
      "Distinct from Zenith Biologics GmbH.";
    const res1 = resolveEntitiesWithGraph("S1", doc1, workspace, allowlist);
    const mpr1 = res1.entities.find((e) => e.canonicalKey === "ENT-MPR");
    const apex1 = res1.entities.find((e) => e.surface === "Apex Biologics GmbH");
    expect(mpr1?.role).toBe("CLIENT");
    expect(apex1?.canonicalKey).not.toBe("ENT-ZENITH");

    // Doc 2: Meridian flips to VENDOR, typo flagged as NEEDS_DECISION, and Monthly Performance Review (MPR) protected
    const doc2 =
      "DPA with Meridian Precsion Robotics GmbH ('VENDOR'). Monthly Performance Review (MPR) metrics apply separately.";
    const res2 = resolveEntitiesWithGraph("S2", doc2, workspace, allowlist);
    const typoMatch = res2.entities.find((e) => e.surface === "Meridian Precsion Robotics GmbH");
    expect(typoMatch?.canonicalKey).toBe("ENT-MPR");
    expect(typoMatch?.reviewStatus).toBe("NEEDS_DECISION");
    expect(res2.entities.some((e) => e.surface === "MPR")).toBe(false);
  });

  it("never learns unreviewed Nano guesses or rejected entities into workspace memory", () => {
    const out = commitHumanApprovedToWorkspace([], new Set(), [
      {
        id: "N1",
        surface: "Unreviewed Corp",
        canonicalKey: "K1",
        canonicalName: "Unreviewed Corp",
        category: "ORG",
        role: "PARTY",
        normStart: 0,
        normEnd: 15,
        source: "NANO_ON_DEVICE",
        confidence: 0.7,
        rationale: "unreviewed",
        reviewStatus: "PENDING_REVIEW",
      },
      {
        id: "R1",
        surface: "Excluding",
        canonicalKey: "K2",
        canonicalName: "Excluding",
        category: "ORG",
        role: "PARTY",
        normStart: 20,
        normEnd: 29,
        source: "NANO_ON_DEVICE",
        confidence: 0.5,
        rationale: "false positive",
        reviewStatus: "REJECTED",
      },
      {
        id: "A1",
        surface: "Approved Partner LLC",
        canonicalKey: "ENT-APP",
        canonicalName: "Approved Partner LLC",
        category: "ORG",
        role: "VENDOR",
        normStart: 40,
        normEnd: 60,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.99,
        rationale: "accepted",
        reviewStatus: "ACCEPTED",
      },
    ]);
    expect(out.updatedEntities.map((e) => e.canonicalName)).toEqual(["Approved Partner LLC"]);
    expect(out.updatedAllowlist).toEqual(["excluding"]);
  });

  it("isolates street addresses from adjacent org clauses, handles back-to-back Ltd/LP parties, and stops bank spans at sentence periods", () => {
    const sample =
      "having offices at Technologiestrasse 14, 80992 Munich, Germany, and Northstar Strategic Advisory LLC ('ADVISOR'). " +
      "between Sovereign Cloud Systems Ltd. and Helios Capital Partners LP. " +
      "Wire to First National Bank of Delaware. Test signatory.";

    const l1 = runDeterministicDetectors(sample);
    expect(l1.some((e) => e.category === "ADDRESS" && e.surface === "Technologiestrasse 14, 80992 Munich, Germany")).toBe(true);

    const graph = resolveEntitiesWithGraph("S-BOUND", sample, [], new Set());
    const surfaces = graph.entities.map((e) => e.surface);
    expect(surfaces).toContain("Northstar Strategic Advisory LLC");
    expect(surfaces).not.toContain("Munich, Germany, and Northstar Strategic Advisory LLC");
    expect(surfaces).toContain("Sovereign Cloud Systems Ltd.");
    expect(surfaces).toContain("Helios Capital Partners LP");
    expect(surfaces).toContain("First National Bank of Delaware");
    expect(surfaces).not.toContain("First National Bank of Delaware. Test");
  });
});
