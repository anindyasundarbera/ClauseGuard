import { describe, expect, it } from "vitest";
import { normalizeModelConfidence, vetModelCandidate } from "../../src/core/detection/candidateFilters.ts";
import { runDeterministicDetectors } from "../../src/core/detection/deterministicDetectors.ts";
import { resolveEntitiesWithGraph } from "../../src/core/intelligence/entityGraph.ts";
import { extractGroundedEntitiesFromRawNanoOutput } from "../../src/core/orchestration/nanoAdapter.ts";
import type { DetectedEntity } from "../../src/core/types.ts";
import { detectionNote, groupForReview, reviewCounts } from "../../src/ui/viewModel.ts";

// Made-up hospital report. Names, numbers and places are fictional.
const REPORT = [
  "CITY CARE HOSPITAL Page 3 of 5",
  "Patient Name : Mr Ravi Shankar Pal Age : 58 Gender : Male UHID : 99120000033417",
  "Consultant : Dr. Meera Dutta Gender : Female",
  "Address : NANDIGRAM, EAST DISTRICT, NANDIGRAM,West Bengal,India,-700001",
  "Date : 18/07/2026 ANAESTHESIA PLAN Plan Type : General anaesthesia",
  "BILATERAL INGUINAL HERNIOPLASTY",
  "Eosinophils 1.0 20.0-40.0 Monocytes 8.7 2.0-10.0",
  "ASA Score : ASA III NPO Hours : 6 ET",
  "Ref 99120000033417 billed to Mr Ravi Shankar Pal.",
].join("\n");

const chunk = { chunkIndex: 0, text: REPORT, normStart: 0, normEnd: REPORT.length, conservativeTokens: 0 };

/** What a small on-device model actually returned for a real report of this shape. */
const NOISY_MODEL_OUTPUT = JSON.stringify([
  { v: "99120000033417", t: "PERSON", c: 0 },
  { v: "Mr Ravi Shankar Pal", t: "PERSON", c: 0 },
  { v: "Dr. Meera Dutta Gender", t: "PERSON", c: 0.89 },
  { v: "ANAESTHESIA PLAN Plan Type : General anaesthesia", t: "PERSON", c: 0 },
  { v: "BILATERAL INGUINAL HERNIOPLASTY", t: "PERSON", c: 0 },
  { v: "NANDIGRAM, EAST DISTRICT, NANDIGRAM,West Bengal,India,-700001", t: "ADDRESS", c: 0 },
  { v: "18/07/2026", t: "ADDRESS", c: 0 },
  { v: "Page 3 of 5", t: "ADDRESS", c: 0 },
  { v: "ET", t: "ADDRESS", c: 0 },
  { v: "General anaesthesia", t: "ADDRESS", c: 0 },
  { v: "20.0-40.0", t: "CODENAME", c: 0 },
  { v: "Eosinophils", t: "CODENAME", c: 0 },
  { v: "8.7", t: "CODENAME", c: 0 },
  { v: "ASA Score : ASA III", t: "CODENAME", c: 0 },
  { v: "Monocytes", t: "SOMETHING_ELSE", c: 0 },
  { v: "CITY CARE HOSPITAL", t: "ORG", c: 72 },
]);

describe("Non-contract documents: on-device suggestions are checked by type", () => {
  it("drops numbers, dates, lab values, headings and form labels; keeps real names and addresses", () => {
    const got = extractGroundedEntitiesFromRawNanoOutput(NOISY_MODEL_OUTPUT, chunk);
    const byCat = (c: string) => [...new Set(got.filter((e) => e.category === c).map((e) => e.surface))].sort();

    expect(byCat("PERSON")).toEqual(["Dr. Meera Dutta", "Mr Ravi Shankar Pal"]);
    expect(byCat("ADDRESS")).toEqual(["NANDIGRAM, EAST DISTRICT, NANDIGRAM,West Bengal,India,-700001"]);
    expect(byCat("CODENAME")).toEqual([]);
    expect(byCat("ORG")).toEqual(["CITY CARE HOSPITAL"]);
    // Every occurrence of a kept name is still found, so all of them get hidden.
    expect(got.filter((e) => e.surface === "Mr Ravi Shankar Pal")).toHaveLength(2);
  });

  it("reads model confidence as 0-1 or 0-100, and treats 0 or missing as not given", () => {
    expect(normalizeModelConfidence(0)).toBeUndefined();
    expect(normalizeModelConfidence(undefined)).toBeUndefined();
    expect(normalizeModelConfidence(0.8)).toBe(0.8);
    expect(normalizeModelConfidence(72)).toBe(0.72);
    expect(normalizeModelConfidence(400)).toBeUndefined();
    const got = extractGroundedEntitiesFromRawNanoOutput(NOISY_MODEL_OUTPUT, chunk);
    expect(got.every((e) => e.confidence > 0)).toBe(true);
  });

  it("keeps genuine contract-style suggestions", () => {
    expect(vetModelCandidate("Hartwell Property Holdings LLC", "ORG")?.category).toBe("ORG");
    expect(vetModelCandidate("Maya Okafor", "PERSON")?.surface).toBe("Maya Okafor");
    expect(vetModelCandidate("Project Nightingale", "CODENAME")?.category).toBe("CODENAME");
    expect(vetModelCandidate("Lindenstrasse 48, 10115 Berlin, Germany", "ADDRESS")?.category).toBe("ADDRESS");
  });
});

describe("Pattern detectors stop at the end of a name or address", () => {
  it("does not pull the next form label into a doctor's or patient's name", () => {
    const { entities } = resolveEntitiesWithGraph("s1", REPORT, [], new Set());
    const people = [...new Set(entities.filter((e) => e.category === "PERSON").map((e) => e.surface))].sort();
    expect(people).toEqual(["Dr. Meera Dutta", "Mr Ravi Shankar Pal"]);
  });

  it("ends a street address at the sentence end", () => {
    const text = "Tenant address: Lindenstrasse 48, 10115 Berlin, Germany. Tenant contact: none.";
    const addr = runDeterministicDetectors(text).filter((e) => e.category === "ADDRESS");
    expect(addr.map((e) => e.surface)).toEqual(["Lindenstrasse 48, 10115 Berlin, Germany"]);
  });

  it("finds long reference numbers as ID numbers, not names", () => {
    const ids = runDeterministicDetectors(REPORT).filter((e) => e.category === "ID_NUMBER");
    expect(ids.map((e) => e.surface)).toEqual(["99120000033417", "99120000033417"]);
    expect(ids[0].reviewStatus).toBe("ACCEPTED"); // labelled "UHID :"
    expect(ids[1].reviewStatus).toBe("PENDING_REVIEW"); // bare number
    // Lab values, dates and short numbers are not IDs.
    expect(runDeterministicDetectors("Eosinophils 1.0 20.0-40.0 on 18/07/2026, 6 hours").length).toBe(0);
  });
});

describe("Review list shows each repeated item once", () => {
  const mk = (id: string, surface: string, source: DetectedEntity["source"], confidence: number): DetectedEntity => ({
    id,
    surface,
    canonicalKey: surface,
    canonicalName: surface,
    category: "PERSON",
    role: "PARTY",
    normStart: 0,
    normEnd: surface.length,
    source,
    confidence,
    rationale: "",
    reviewStatus: "PENDING_REVIEW",
  });

  it("groups repeats into one row and labels AI suggestions without a fake percentage", () => {
    const ents = [
      mk("a", "Dr. Meera Dutta", "PREAMBLE_DEFINITION", 0.89),
      mk("b", "Dr. Meera Dutta", "PREAMBLE_DEFINITION", 0.89),
      mk("c", "Mr Ravi Shankar Pal", "NANO_ON_DEVICE", 0.6),
      mk("d", "mr ravi shankar  pal", "NANO_ON_DEVICE", 0.6),
      mk("e", "Mr Ravi Shankar Pal", "NANO_ON_DEVICE", 0.6),
    ];
    const rows = groupForReview(ents).get("PERSON") ?? [];
    expect(rows.map((r) => r.length)).toEqual([2, 3]);
    expect(detectionNote(rows[0])).toBe("89% sure");
    expect(detectionNote(rows[1])).toBe("suggested by on-device AI");
    expect(reviewCounts(ents)).toEqual({ found: 2, pending: 2, hidden: 0, visible: 0 });
  });
});
