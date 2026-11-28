import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyThemeChoice,
  effectiveTheme,
  initThemeControls,
  readThemeChoice,
  saveThemeChoice,
} from "../../src/ui/theme.ts";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
  } as unknown as Storage;
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error("storage blocked");
  };
  return {
    get length() {
      return 0;
    },
    key: fail,
    getItem: fail,
    setItem: fail,
    removeItem: fail,
    clear: fail,
  } as unknown as Storage;
}

describe("theme storage", () => {
  it("uses the cg-theme key", () => {
    expect(THEME_STORAGE_KEY).toBe("cg-theme");
  });

  it("reads a stored light or dark choice and defaults to system", () => {
    expect(readThemeChoice(fakeStorage({ "cg-theme": "light" }))).toBe("light");
    expect(readThemeChoice(fakeStorage({ "cg-theme": "dark" }))).toBe("dark");
    expect(readThemeChoice(fakeStorage())).toBe("system");
    expect(readThemeChoice(fakeStorage({ "cg-theme": "neon" }))).toBe("system");
    expect(readThemeChoice(null)).toBe("system");
  });

  it("falls back to system when storage throws", () => {
    expect(readThemeChoice(throwingStorage())).toBe("system");
  });

  it("saves light and dark, and removes the key for system", () => {
    const storage = fakeStorage();
    saveThemeChoice("dark", storage);
    expect(storage.getItem("cg-theme")).toBe("dark");
    saveThemeChoice("light", storage);
    expect(storage.getItem("cg-theme")).toBe("light");
    saveThemeChoice("system", storage);
    expect(storage.getItem("cg-theme")).toBeNull();
  });

  it("does not throw when saving to throwing storage", () => {
    expect(() => saveThemeChoice("dark", throwingStorage())).not.toThrow();
    expect(() => saveThemeChoice("system", throwingStorage())).not.toThrow();
  });
});

describe("applyThemeChoice", () => {
  it("sets or removes data-theme on the root", () => {
    const root = document.createElement("html");
    applyThemeChoice("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyThemeChoice("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
    applyThemeChoice("system", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

describe("effectiveTheme", () => {
  it("follows the device for system and returns the fixed choice otherwise", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });
});

describe("initThemeControls", () => {
  let group: HTMLElement;
  let cleanup: (() => void) | undefined;

  const button = (choice: string): HTMLButtonElement =>
    group.querySelector<HTMLButtonElement>(`[data-theme-choice="${choice}"]`) as HTMLButtonElement;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    group = document.createElement("div");
    group.setAttribute("role", "radiogroup");
    group.innerHTML = `
      <button type="button" role="radio" data-theme-choice="system">System</button>
      <button type="button" role="radio" data-theme-choice="light">Light</button>
      <button type="button" role="radio" data-theme-choice="dark">Dark</button>
      <p data-theme-note></p>
    `;
    document.body.appendChild(group);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    group.remove();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("marks the stored choice as checked with roving tabindex", () => {
    localStorage.setItem("cg-theme", "light");
    cleanup = initThemeControls(group);
    expect(button("light").getAttribute("aria-checked")).toBe("true");
    expect(button("light").tabIndex).toBe(0);
    expect(button("system").getAttribute("aria-checked")).toBe("false");
    expect(button("system").tabIndex).toBe(-1);
    expect(button("dark").tabIndex).toBe(-1);
  });

  it("clicking Dark applies, saves and checks it", () => {
    cleanup = initThemeControls(group);
    button("dark").click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("cg-theme")).toBe("dark");
    expect(button("dark").getAttribute("aria-checked")).toBe("true");
    expect(button("system").getAttribute("aria-checked")).toBe("false");
  });

  it("ArrowRight moves to the next choice and selects it", () => {
    cleanup = initThemeControls(group);
    button("system").focus();
    button("system").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(button("light").getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.activeElement).toBe(button("light"));
  });

  it("choosing System removes data-theme and the saved key", () => {
    localStorage.setItem("cg-theme", "dark");
    cleanup = initThemeControls(group);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    button("system").click();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("cg-theme")).toBeNull();
  });

  it("writes the device note for system and clears it otherwise", () => {
    const note = group.querySelector<HTMLElement>("[data-theme-note]") as HTMLElement;
    cleanup = initThemeControls(group);
    expect(note.textContent).toBe("Follows your device. Now: Light.");
    button("dark").click();
    expect(note.textContent).toBe("");
    button("system").click();
    expect(note.textContent).toBe("Follows your device. Now: Light.");
  });

  it("cleanup stops responding to clicks", () => {
    cleanup = initThemeControls(group);
    cleanup();
    cleanup = undefined;
    button("dark").click();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
