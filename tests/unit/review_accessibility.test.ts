import { describe, expect, it } from "vitest";
import type { DetectedEntity } from "../../src/core/types.ts";
import {
  NUMBER_CATEGORIES,
  detectionNote,
  idsToHide,
  reviewAnnouncement,
  reviewContinueBlocker,
} from "../../src/ui/viewModel.ts";

const mk = (
  id: string,
  category: DetectedEntity["category"],
  reviewStatus: DetectedEntity["reviewStatus"],
  extra: Partial<DetectedEntity> = {}
): DetectedEntity => ({
  id,
  surface: id,
  canonicalKey: id,
  canonicalName: id,
  category,
  role: "PARTY",
  normStart: 0,
  normEnd: 1,
  source: "DETERMINISTIC_L1",
  confidence: 0,
  rationale: "",
  reviewStatus,
  ...extra,
});

describe("Review accessibility helpers", () => {
  it("gives a plain reason instead of a percentage, even at 0 confidence", () => {
    expect(detectionNote([mk("a", "PHONE", "PENDING_REVIEW")])).toBe("looks like a phone number");
    expect(detectionNote([mk("b", "EMAIL", "PENDING_REVIEW")])).toBe("looks like an email address");
    expect(detectionNote([mk("c", "ID_NUMBER", "PENDING_REVIEW", { fieldLabel: "UHID" })])).toBe(
      'next to the label "UHID"'
    );
    expect(detectionNote([mk("d", "ORG", "PENDING_REVIEW", { source: "WORKSPACE_GRAPH" })])).toBe(
      "seen in your earlier documents"
    );
    expect(detectionNote([mk("e", "PERSON", "PENDING_REVIEW")])).not.toMatch(/%/);
  });

  it("bulk hide targets only items not already hidden, optionally by category", () => {
    const ents = [
      mk("p1", "PERSON", "PENDING_REVIEW"),
      mk("p2", "PERSON", "ACCEPTED"),
      mk("p3", "PERSON", "REJECTED"),
      mk("n1", "PHONE", "NEEDS_DECISION"),
      mk("o1", "ORG", "PENDING_REVIEW"),
    ];
    expect(idsToHide(ents, new Set(["PERSON"]))).toEqual(["p1", "p3"]);
    expect(idsToHide(ents, NUMBER_CATEGORIES)).toEqual(["n1"]);
    expect(idsToHide(ents)).toEqual(["p1", "p3", "n1", "o1"]);
  });

  it("announces the outcome once, not activity", () => {
    expect(reviewAnnouncement("Hidden", 7)).toBe("Hidden. 7 left to decide.");
    expect(reviewAnnouncement("Kept visible", 0)).toBe("Kept visible. Every item has a choice now.");
    expect(reviewAnnouncement("Hidden", 3)).not.toMatch(/Updating/);
  });

  it("never lets Continue skip undecided items silently", () => {
    expect(reviewContinueBlocker(0)).toBeNull();
    expect(reviewContinueBlocker(1)).toBe("1 detail still needs a choice. Hide it and continue, or go back to choose.");
    expect(reviewContinueBlocker(8)).toBe("8 details still need a choice. Hide them and continue, or go back to choose.");
  });
});
