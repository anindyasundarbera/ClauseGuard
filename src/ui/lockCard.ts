/** Pure helpers for the warning banner and the "Stays on this device" lock card. */

/** Auto-close delay after the card opens by itself, and the shorter one after the pointer or focus leaves. */
export const CARD_OPEN_MS = 4000;
export const CARD_LEAVE_MS = 2000;

/** The button's accessible name. */
export function lockLabel(hidden: number): string {
  const n = Number.isFinite(hidden) && hidden > 0 ? Math.floor(hidden) : 0;
  return `Stays on this device: ${n} detail${n === 1 ? "" : "s"} hidden`;
}

/** A stable key for a set of warnings, so a closed banner stays closed until a different warning appears. */
export function warningKey(warnings: readonly string[]): string {
  return [...warnings].sort().join("\n");
}

/** Whether the banner should show: there are warnings and the person has not closed this same set. */
export function showWarnings(warnings: readonly string[], dismissedKey: string | null): boolean {
  return warnings.length > 0 && warningKey(warnings) !== dismissedKey;
}
