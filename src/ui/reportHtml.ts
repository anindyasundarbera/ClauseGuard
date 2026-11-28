import type { PrivacyProcessingAndEgressReport16 } from "../core/types.ts";

export interface ReadableReportOptions {
  hiddenItems: { label: string; category: string }[];
  findingsCount: number;
  /** Total hidden details when hiddenItems is grouped (for example "6 money amounts"). */
  hiddenTotal?: number;
}

/** Escapes text for safe use in HTML element content and attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Turns a machine category such as PERSON_NAME into words such as "person name". */
function categoryInWords(category: string): string {
  return String(category).replace(/[_-]+/g, " ").trim().toLowerCase();
}

function formatDate(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return escapeHtml(isoUtc);
  return escapeHtml(
    date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }),
  );
}

function bulletList(items: string[]): string {
  if (items.length === 0) return `<p class="muted">Nothing to show here.</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

const STYLE = `
  :root {
    --bg: #FDFCF8;
    --ink: #2A3433;
    --accent: #3F7A70;
    --muted: #6B7573;
    --rule: #E4E1D8;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #1E2423;
      --ink: #E8ECEA;
      --accent: #8CC4B8;
      --muted: #A4AEAB;
      --rule: #3A4342;
    }
  }
  :root[data-theme="dark"] {
    --bg: #1E2423;
    --ink: #E8ECEA;
    --accent: #8CC4B8;
    --muted: #A4AEAB;
    --rule: #3A4342;
  }
  html, body { background: var(--bg); }
  body {
    margin: 0;
    color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 17px;
    line-height: 1.6;
  }
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 20px 64px;
  }
  h1, h2 {
    font-family: Georgia, "Times New Roman", serif;
    color: var(--accent);
    font-weight: 600;
    line-height: 1.25;
  }
  h1 { font-size: 2.1rem; margin: 0 0 4px; }
  h2 { font-size: 1.3rem; margin: 36px 0 10px; padding-top: 16px; border-top: 1px solid var(--rule); }
  .date { color: var(--muted); margin: 0 0 24px; }
  .summary { font-size: 1.15rem; margin: 0 0 8px; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  .muted { color: var(--muted); }
  .tech { font-size: 0.85rem; color: var(--muted); margin-top: 48px; }
  .tech h2 { font-size: 1rem; color: var(--muted); border-top: 1px solid var(--rule); }
  .tech dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
  .tech dt { font-weight: 600; }
  .tech dd { margin: 0; word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace; }
  @media print {
    html, body { background: #FFFFFF; color: #000000; }
    main { padding: 0; max-width: none; }
    h1, h2 { color: #000000; }
    .tech, .muted, .date { color: #444444; }
    h2 { break-after: avoid; }
  }
`;

/**
 * Builds a complete standalone HTML privacy report for a non-technical reader.
 * Contains no scripts and no external resources.
 */
export function buildReadablePrivacyReport(
  report: PrivacyProcessingAndEgressReport16,
  opts: ReadableReportOptions,
): string {
  const hidden = opts.hiddenItems;
  const hiddenCount = opts.hiddenTotal ?? hidden.length;
  const cloudUsed =
    report.cloud_inference_source !== null && report.privacy_mode === "HYBRID_ANONYMIZED";

  const hiddenSentence =
    hiddenCount === 1
      ? "1 detail was hidden before anything left this device."
      : `${hiddenCount} details were hidden before anything left this device.`;
  const cloudSentence = cloudUsed
    ? "Only the cleaned text you approved was sent for a deeper check."
    : "Nothing was sent to the cloud.";

  const whereChecked = cloudUsed
    ? "On this device and in the cloud."
    : "On this device.";

  const hiddenItemsHtml =
    hidden.length === 0
      ? `<p class="muted">No details were hidden.</p>`
      : `<ul>${hidden
          .map(
            (item) =>
              item.category
                ? `<li>${escapeHtml(item.label)} <span class="muted">(${escapeHtml(categoryInWords(item.category))})</span></li>`
                : `<li>${escapeHtml(item.label)}</li>`,
          )
          .join("")}</ul>`;

  const approvedHash =
    report.approved_payload_sha256 === null ? "none" : report.approved_payload_sha256;
  const cloudSource = report.cloud_inference_source === null ? "none" : report.cloud_inference_source;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClauseGuard privacy report</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Your privacy report</h1>
  <p class="date">Created ${formatDate(report.generated_at_utc)}</p>

  <p class="summary">${escapeHtml(hiddenSentence)}</p>
  <p class="summary">${escapeHtml(cloudSentence)}</p>

  <h2>Where the check ran</h2>
  <p>${escapeHtml(whereChecked)}</p>

  <h2>What was hidden</h2>
  ${hiddenItemsHtml}

  <h2>What we checked</h2>
  <p>${opts.findingsCount === 0 ? "No results were made yet." : `The check found ${escapeHtml(opts.findingsCount)} ${opts.findingsCount === 1 ? "thing" : "things"} worth a look.`}</p>
  <ul>
    <li>Your document was read and cleaned inside this browser tab.</li>
    <li>If the private check on this device could not run, nothing was sent to the cloud in its place.</li>
    <li>${cloudUsed ? "The text that was sent matched the text you approved, exactly." : "No text was approved or sent."}</li>
  </ul>

  <h2>What we could not check</h2>
  <ul>
    <li>Browser add-ons that are allowed to read every page you open.</li>
    <li>Network traffic from other apps on this device.</li>
  </ul>

  <h2>Good to know</h2>
  <p>This report shows what ClauseGuard did with your document. It is not a legal or compliance certificate, and ClauseGuard does not give legal advice.</p>

  <section class="tech" aria-label="Technical details">
    <h2>Technical details</h2>
    <dl>
      <dt>Report ID</dt><dd>${escapeHtml(report.report_id)}</dd>
      <dt>Session ID</dt><dd>${escapeHtml(report.session_id)}</dd>
      <dt>Privacy mode</dt><dd>${escapeHtml(report.privacy_mode)}</dd>
      <dt>Document fingerprint</dt><dd>${escapeHtml(report.raw_document_sha256)}</dd>
      <dt>Approved payload fingerprint</dt><dd>${escapeHtml(approvedHash)}</dd>
      <dt>Redaction map version</dt><dd>${escapeHtml(report.redaction_map_version)}</dd>
      <dt>Local inference source</dt><dd>${escapeHtml(report.local_inference_source)}</dd>
      <dt>Cloud inference source</dt><dd>${escapeHtml(cloudSource)}</dd>
    </dl>
    <p class="muted">Checked:</p>
    ${bulletList(report.verified_properties)}
    <p class="muted">Not checked:</p>
    ${bulletList(report.unverified_external_properties)}
    <p class="muted">${escapeHtml(report.known_limitations_and_non_certification_disclaimer)}</p>
  </section>
</main>
</body>
</html>
`;
}
