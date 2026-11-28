/**
 * Pure helpers for the document view: cut the document text into plain text, page breaks and
 * marked details, so the page can draw found details in place. No DOM here.
 */
import type { DetectedEntity } from "../core/types.ts";

export type MarkState = "hidden" | "undecided" | "shown";

export type DocSegment =
  | { kind: "text"; text: string }
  | { kind: "page"; page: number }
  | { kind: "mark"; text: string; entityId: string; state: MarkState };

type MarkSource = Pick<DetectedEntity, "id" | "normStart" | "normEnd" | "reviewStatus">;

export function markState(status: DetectedEntity["reviewStatus"]): MarkState {
  if (status === "ACCEPTED") return "hidden";
  if (status === "REJECTED") return "shown";
  return "undecided";
}

/**
 * Cut `text` at every found detail. Overlapping details keep the one that starts first (the longer
 * one when they start together). Page starts become "page" segments when there is more than one page.
 */
export function buildDocSegments(
  text: string,
  entities: MarkSource[],
  pageStarts: Array<{ normStart: number; page: number }> = []
): DocSegment[] {
  const out: DocSegment[] = [];
  const pages = pageStarts.length > 1 ? [...pageStarts].sort((a, b) => a.normStart - b.normStart) : [];
  const marks = entities
    .filter((e) => Number.isInteger(e.normStart) && Number.isInteger(e.normEnd) && e.normStart >= 0 && e.normEnd > e.normStart && e.normEnd <= text.length)
    .sort((a, b) => a.normStart - b.normStart || b.normEnd - a.normEnd);

  let cursor = 0;
  let pi = 0;
  const flushPages = (upTo: number): void => {
    while (pi < pages.length && pages[pi].normStart <= upTo) {
      out.push({ kind: "page", page: pages[pi].page });
      pi++;
    }
  };
  const pushText = (to: number): void => {
    while (cursor < to) {
      flushPages(cursor);
      const nextPage = pi < pages.length ? pages[pi].normStart : Infinity;
      const stop = Math.min(to, nextPage > cursor ? nextPage : to);
      if (stop > cursor) out.push({ kind: "text", text: text.slice(cursor, stop) });
      cursor = stop;
    }
  };

  for (const m of marks) {
    if (m.normStart < cursor) continue;
    pushText(m.normStart);
    flushPages(m.normStart);
    out.push({ kind: "mark", text: text.slice(m.normStart, m.normEnd), entityId: m.id, state: markState(m.reviewStatus) });
    cursor = m.normEnd;
  }
  pushText(text.length);
  return out;
}

/** "name · page 2 of 5" when the page count is known (more than one page), else just the name. */
export function docHeaderText(name: string, page: number, pageCount: number): string {
  if (pageCount > 1) return `${name} · page ${Math.min(Math.max(page, 1), pageCount)} of ${pageCount}`;
  return name;
}

/** The popover sentence for a mark: what it is and what happens to it. */
export function markStateText(state: MarkState): string {
  if (state === "hidden") return "Hidden. It will be replaced before anything is sent.";
  if (state === "shown") return "Kept visible. It will be included as written.";
  return "Needs a choice. Not decided yet.";
}

/** The one action a mark offers, or null when the choice cannot be changed here. */
export function markAction(state: MarkState): { label: string; status: "ACCEPTED" | "REJECTED" } {
  return state === "hidden" ? { label: "Show instead", status: "REJECTED" } : { label: "Hide", status: "ACCEPTED" };
}
