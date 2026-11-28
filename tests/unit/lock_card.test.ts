import { describe, expect, it } from "vitest";
import { lockLabel, showWarnings, warningKey } from "../../src/ui/lockCard.ts";

describe("lock card helpers", () => {
  it("builds the button name with singular and plural", () => {
    expect(lockLabel(12)).toBe("Stays on this device: 12 details hidden");
    expect(lockLabel(1)).toBe("Stays on this device: 1 detail hidden");
    expect(lockLabel(0)).toBe("Stays on this device: 0 details hidden");
    expect(lockLabel(Number.NaN)).toBe("Stays on this device: 0 details hidden");
  });
  it("keeps a closed warning closed, and shows a different one", () => {
    const a = ["Names may be missed."];
    const key = warningKey(a);
    expect(showWarnings(a, null)).toBe(true);
    expect(showWarnings(a, key)).toBe(false);
    expect(showWarnings([...a, "Another one."], key)).toBe(true);
    expect(showWarnings([], null)).toBe(false);
  });
  it("ignores warning order", () => {
    expect(warningKey(["b", "a"])).toBe(warningKey(["a", "b"]));
  });
});
