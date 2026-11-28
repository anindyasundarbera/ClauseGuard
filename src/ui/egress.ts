/**
 * "Left this device": counts the requests this page makes to other sites, read from the browser's
 * own Resource Timing entries (not from the app's own bookkeeping), and says plainly which of them
 * could carry document text. Only the cloud AI call can, and only after approval.
 */

export type EgressKind = "ai" | "support" | "other";

export interface EgressCounts {
  ai: number;
  support: number;
  other: number;
}

const AI_HOSTS = ["firebasevertexai.googleapis.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com"];
const SUPPORT_HOST_PARTS = [
  "firebaseappcheck.googleapis.com",
  "content-firebaseappcheck.googleapis.com",
  "firebaseremoteconfig.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firebaselogging",
  "recaptcha",
  "gstatic.com",
  "www.google.com",
];

/** null = same site as the app (its own files), which is not "leaving". */
export function classifyRequest(url: string, ownOrigin: string): EgressKind | null {
  let u: URL;
  try {
    u = new URL(url, ownOrigin);
  } catch {
    return "other";
  }
  if (u.protocol === "data:" || u.protocol === "blob:") return null;
  if (u.origin === ownOrigin) return null;
  const host = u.hostname.toLowerCase();
  if (AI_HOSTS.includes(host) || /:(stream)?generateContent\b/i.test(u.pathname)) return "ai";
  if (SUPPORT_HOST_PARTS.some((p) => host.includes(p))) return "support";
  return "other";
}

export interface EgressView {
  /** Big number: requests to cloud AI (the only ones that may carry document text). */
  aiCount: number;
  /** Words after the number, e.g. "requests to cloud AI". */
  label: string;
  detail: string;
  readingOn: string;
  others: string | null;
}

export function describeEgress(p: {
  counts: EgressCounts;
  /** Set once a deeper check finished. */
  cloudSource: "in_cloud" | "SIMULATED_CLOUD_SYNTHESIS" | null;
  approvedSha: string | null;
  /** How the current document was read. */
  localSource: "on_device" | "rules" | null;
}): EgressView {
  const { counts } = p;
  const n = counts.ai;
  const label = `request${n === 1 ? "" : "s"} to cloud AI`;
  let detail: string;
  if (n === 0 && p.cloudSource === "SIMULATED_CLOUD_SYNTHESIS") {
    detail = "Practice mode: the deeper check ran here and nothing was sent.";
  } else if (n === 0) {
    detail = "Nothing from your document is sent until you approve the exact text.";
  } else if (p.approvedSha) {
    detail = `Sent only the text you approved. Its fingerprint ${shortSha(p.approvedSha)} was checked before sending.`;
  } else {
    detail = "Sent only text you approved.";
  }
  const readingOn =
    p.localSource === "on_device"
      ? "Read on this device by private AI (Gemini Nano)."
      : p.localSource === "rules"
        ? "Read on this device by built-in rules. Private AI isn't available in this browser."
        : "Your document is read on this device.";
  const extra = counts.support + counts.other;
  let others: string | null = null;
  if (extra > 0) {
    const parts: string[] = [];
    if (counts.support > 0) parts.push(`${counts.support} for app settings and the security check`);
    if (counts.other > 0) parts.push(`${counts.other} other`);
    others =
      counts.other > 0
        ? `Other connections: ${parts.join(", ")}. Your browser's Network tools (F12) list each one.`
        : `Other connections: ${parts.join(", ")}. These never include your document.`;
  }
  return { aiCount: n, label, detail, readingOn, others };
}

export function shortSha(sha: string): string {
  const s = sha.replace(/^sha256:/i, "");
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

/** Watches Resource Timing for the life of the page. Calls onChange whenever a count changes. */
export function watchEgress(onChange: (c: EgressCounts) => void): () => EgressCounts {
  const counts: EgressCounts = { ai: 0, support: 0, other: 0 };
  const seen = new WeakSet<PerformanceEntry>();
  const origin = typeof location !== "undefined" ? location.origin : "";
  const take = (entries: PerformanceEntryList): void => {
    let changed = false;
    for (const e of entries) {
      if (seen.has(e)) continue;
      seen.add(e);
      const kind = classifyRequest(e.name, origin);
      if (kind) {
        counts[kind]++;
        changed = true;
      }
    }
    if (changed) onChange({ ...counts });
  };
  try {
    performance.setResourceTimingBufferSize?.(2000);
  } catch { /* not supported */ }
  try {
    const obs = new PerformanceObserver((list) => take(list.getEntries()));
    obs.observe({ type: "resource", buffered: true });
  } catch {
    try {
      take(performance.getEntriesByType("resource"));
    } catch { /* no Resource Timing */ }
  }
  return () => ({ ...counts });
}
