import { describe, expect, it } from "vitest";
import { clearTally, readTally, recordTally, tallyText, TALLY_KEY } from "../../src/ui/tally.ts";

const fake = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const throwing = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

describe("on-device tally", () => {
  it("starts at zero and adds up", () => {
    const s = fake();
    expect(readTally(s)).toEqual({ docs: 0, details: 0 });
    recordTally(11, s);
    expect(recordTally(3, s)).toEqual({ docs: 2, details: 14 });
    expect(readTally(s)).toEqual({ docs: 2, details: 14 });
  });
  it("clears", () => {
    const s = fake();
    recordTally(2, s);
    clearTally(s);
    expect(s.m.has(TALLY_KEY)).toBe(false);
    expect(readTally(s)).toEqual({ docs: 0, details: 0 });
  });
  it("ignores corrupt data", () => {
    const s = fake();
    s.setItem(TALLY_KEY, "{nope");
    expect(readTally(s)).toEqual({ docs: 0, details: 0 });
    s.setItem(TALLY_KEY, JSON.stringify({ docs: -4, details: "x" }));
    expect(readTally(s)).toEqual({ docs: 0, details: 0 });
  });
  it("never throws when storage throws", () => {
    expect(readTally(throwing)).toEqual({ docs: 0, details: 0 });
    expect(() => recordTally(5, throwing)).not.toThrow();
    expect(() => clearTally(throwing)).not.toThrow();
    expect(readTally(null)).toEqual({ docs: 0, details: 0 });
  });
  it("uses singular forms", () => {
    expect(tallyText({ docs: 1, details: 1 })).toBe("You've kept 1 detail private across 1 document. Only this device knows.");
    expect(tallyText({ docs: 5, details: 48 })).toBe("You've kept 48 details private across 5 documents. Only this device knows.");
  });
});
