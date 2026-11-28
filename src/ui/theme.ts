export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "cg-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readThemeChoice(storage: Storage | null = defaultStorage()): ThemeChoice {
  try {
    const value = storage ? storage.getItem(THEME_STORAGE_KEY) : null;
    return isThemeChoice(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function saveThemeChoice(choice: ThemeChoice, storage: Storage | null = defaultStorage()): void {
  try {
    if (!storage) return;
    if (choice === "system") {
      storage.removeItem(THEME_STORAGE_KEY);
    } else {
      storage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Saving is a convenience. The choice still applies for this page view.
  }
}

export function applyThemeChoice(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

export function effectiveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

function getDarkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_QUERY);
}

/**
 * Wires a radiogroup of buttons (data-theme-choice="system|light|dark", role="radio").
 * Returns a cleanup function that removes every listener it added.
 */
export function initThemeControls(group: HTMLElement): () => void {
  const buttons = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"][data-theme-choice]')
  ).filter((button) => isThemeChoice(button.dataset.themeChoice));
  const note = group.querySelector<HTMLElement>("[data-theme-note]");
  const darkQuery = getDarkQuery();
  const cleanups: Array<() => void> = [];

  const choiceOf = (button: HTMLElement): ThemeChoice =>
    button.dataset.themeChoice as ThemeChoice;

  let current: ThemeChoice = readThemeChoice();

  const prefersDark = (): boolean => (darkQuery ? darkQuery.matches : false);

  const renderNote = (): void => {
    if (!note) return;
    if (current === "system") {
      const now = effectiveTheme("system", prefersDark()) === "dark" ? "Dark" : "Light";
      note.textContent = `Follows your device. Now: ${now}.`;
    } else {
      note.textContent = "";
    }
  };

  const render = (): void => {
    for (const button of buttons) {
      const checked = choiceOf(button) === current;
      button.setAttribute("aria-checked", checked ? "true" : "false");
      button.tabIndex = checked ? 0 : -1;
    }
    renderNote();
  };

  const select = (choice: ThemeChoice): void => {
    current = choice;
    saveThemeChoice(choice);
    applyThemeChoice(choice);
    render();
  };

  buttons.forEach((button, index) => {
    const onClick = (): void => select(choiceOf(button));
    const onKeyDown = (event: KeyboardEvent): void => {
      let target: number | null = null;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          target = (index + 1) % buttons.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          target = (index - 1 + buttons.length) % buttons.length;
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          select(choiceOf(button));
          return;
        default:
          return;
      }
      event.preventDefault();
      const next = buttons[target];
      select(choiceOf(next));
      next.focus();
    };
    button.addEventListener("click", onClick);
    button.addEventListener("keydown", onKeyDown);
    cleanups.push(() => {
      button.removeEventListener("click", onClick);
      button.removeEventListener("keydown", onKeyDown);
    });
  });

  if (darkQuery) {
    const onMediaChange = (): void => {
      if (current === "system") renderNote();
    };
    if (typeof darkQuery.addEventListener === "function") {
      darkQuery.addEventListener("change", onMediaChange);
      cleanups.push(() => darkQuery.removeEventListener("change", onMediaChange));
    } else if (typeof darkQuery.addListener === "function") {
      darkQuery.addListener(onMediaChange);
      cleanups.push(() => darkQuery.removeListener(onMediaChange));
    }
  }

  applyThemeChoice(current);
  render();

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
}
