import { describe, expect, it } from "vitest";
import { buildDocSegments, docHeaderText, markAction, markState } from "../../src/ui/docView.ts";

const ent = (id: string, s: number, e: number, st: "ACCEPTED" | "REJECTED" | "PENDING_REVIEW") => ({
  id,
  normStart: s,
  normEnd: e,
  reviewStatus: st,
});

describe("document view segments", () => {
  it("cuts text around marks and keeps every character", () => {
    const text = "Hello Maya Okafor, call 555.";
    const segs = buildDocSegments(text, [ent("a", 6, 17, "ACCEPTED"), ent("b", 24, 27, "PENDING_REVIEW")]);
    expect(segs.map((s) => (s.kind === "page" ? "" : s.text)).join("")).toBe(text);
    expect(segs.filter((s) => s.kind === "mark").map((s) => (s.kind === "mark" ? s.state : ""))).toEqual(["hidden", "undecided"]);
  });

  it("skips overlapping and out of range marks", () => {
    const segs = buildDocSegments("abcdefgh", [ent("a", 1, 5, "ACCEPTED"), ent("b", 3, 6, "ACCEPTED"), ent("c", 6, 99, "ACCEPTED")]);
    expect(segs.filter((s) => s.kind === "mark")).toHaveLength(1);
  });

  it("adds page marks only when there is more than one page", () => {
    const one = buildDocSegments("abc", [], [{ normStart: 0, page: 1 }]);
    expect(one.some((s) => s.kind === "page")).toBe(false);
    const two = buildDocSegments("abcdef\n\nghi", [ent("a", 8, 9, "REJECTED")], [
      { normStart: 0, page: 1 },
      { normStart: 8, page: 2 },
    ]);
    expect(two.filter((s) => s.kind === "page")).toEqual([
      { kind: "page", page: 1 },
      { kind: "page", page: 2 },
    ]);
    expect(two.map((s) => (s.kind === "page" ? "" : s.text)).join("")).toBe("abcdef\n\nghi");
  });

  it("names the state and the one action", () => {
    expect(markState("NEEDS_DECISION" as never)).toBe("undecided");
    expect(markAction("hidden").label).toBe("Show instead");
    expect(markAction("undecided").status).toBe("ACCEPTED");
  });

  it("builds the header text", () => {
    expect(docHeaderText("a.pdf", 2, 5)).toBe("a.pdf · page 2 of 5");
    expect(docHeaderText("a.txt", 1, 1)).toBe("a.txt");
  });
});
