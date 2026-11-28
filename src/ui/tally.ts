/**
 * A tiny personal tally kept only on this device (localStorage). It never leaves the browser and
 * holds two numbers: documents finished and details kept private. Every access is wrapped so a
 * blocked or full store simply reads as zero and never breaks the app.
 */
export const TALLY_KEY = "cg-tally";

export interface Tally {
  docs: number;
  details: number;
}

type TallyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): TallyStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

export function readTally(store: TallyStore | null = defaultStore()): Tally {
  try {
    const raw = store?.getItem(TALLY_KEY);
    if (!raw) return { docs: 0, details: 0 };
    const p = JSON.parse(raw) as Partial<Tally> | null;
    return { docs: count(p?.docs), details: count(p?.details) };
  } catch {
    return { docs: 0, details: 0 };
  }
}

/** Add one finished document and the details hidden in it. Returns the new totals. */
export function recordTally(details: number, store: TallyStore | null = defaultStore()): Tally {
  const cur = readTally(store);
  const next = { docs: cur.docs + 1, details: cur.details + count(details) };
  try {
    store?.setItem(TALLY_KEY, JSON.stringify(next));
  } catch {
    /* storage may be blocked or full: the tally is a nicety */
  }
  return next;
}

export function clearTally(store: TallyStore | null = defaultStore()): void {
  try {
    store?.removeItem(TALLY_KEY);
  } catch {
    /* ignore */
  }
}

/** "You've kept 48 details private across 5 documents. Only this device knows." */
export function tallyText(t: Tally): string {
  const d = `${t.details} detail${t.details === 1 ? "" : "s"}`;
  const n = `${t.docs} document${t.docs === 1 ? "" : "s"}`;
  return `You've kept ${d} private across ${n}. Only this device knows.`;
}
