import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PrivacyProcessingAndEgressReport16 } from "../core/types.ts";

export interface PdfReportOptions {
  hiddenItems: { label: string; count: number }[];
  hiddenTotal: number;
  sentCount: number;
  findings: { severity: "HIGH" | "MEDIUM" | "LOW"; title: string; message: string }[];
  documentTitle?: string;
}

const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
  "…": "...", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  "•": "•", "\t": " ", "→": "->", "✓": "", "✔": "",
};

/** Maps text to characters the standard PDF fonts (WinAnsi) can draw. Never throws. */
export function toWinAnsi(text: unknown): string {
  let out = "";
  for (const ch of String(text ?? "")) {
    const rep = REPLACEMENTS[ch];
    if (rep !== undefined) { out += rep; continue; }
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)) out += ch;
    else if (ch === "\n") out += " ";
    // everything else (controls, emoji, other scripts) is dropped
  }
  return out;
}

export function pdfFileName(sessionId: string): string {
  return `clauseguard-privacy-report-${sessionId}.pdf`;
}

export function isCloudUsed(report: PrivacyProcessingAndEgressReport16): boolean {
  return report.cloud_inference_source !== null && report.privacy_mode === "HYBRID_ANONYMIZED";
}

export function verdictText(report: PrivacyProcessingAndEgressReport16): string {
  return isCloudUsed(report)
    ? "Only the cleaned text you approved was sent for a deeper check."
    : "Checked on this device. Nothing personal was sent.";
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 48;
const CW = PAGE_W - 2 * M;
const FOOT_Y = 30;
const BOTTOM = 62;

const ACCENT = rgb(0x3f / 255, 0x7a / 255, 0x70 / 255);
const INK = rgb(0x2a / 255, 0x34 / 255, 0x33 / 255);
const MUTED = rgb(0x6b / 255, 0x75 / 255, 0x73 / 255);
const RULE = rgb(0xe4 / 255, 0xe1 / 255, 0xd8 / 255);
const SOFT = rgb(0xef / 255, 0xf5 / 255, 0xf2 / 255);
const hex = (h: string) =>
  rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const PILL = {
  HIGH: { label: "High", bg: hex("#F7E1DC"), fg: hex("#8A3B2B") },
  MEDIUM: { label: "Medium", bg: hex("#FBF1DE"), fg: hex("#7A5216") },
  LOW: { label: "Low", bg: hex("#E3EEEA"), fg: hex("#2D5E56") },
} as const;

/** Wraps text to a width; breaks over-long words by character. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = () => { lines.push(line); line = ""; };
  for (const word of toWinAnsi(text).split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) { line = trial; continue; }
    if (line) push();
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let n = rest.length - 1;
      while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > maxWidth) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) push();
  return lines.length ? lines : [""];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return toWinAnsi(iso);
  return toWinAnsi(d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }));
}

/** Short date for the seal, e.g. "28 NOV 2026". */
export function sealDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

/**
 * The round ClauseGuard seal: two rings, "CLAUSEGUARD" over the top, where it was checked along the bottom,
 * the sealed-page shield, the count and the date in the middle. Drawn slightly tilted, like a pressed stamp.
 */
function drawSeal(
  page: PDFPage,
  cx: number,
  cy: number,
  r: number,
  fonts: { bold: PDFFont; serif: PDFFont },
  lines: { top: string; bottom: string; big: string; date: string },
): void {
  const tilt = -8; // degrees, clockwise
  const rad = (d: number) => (d * Math.PI) / 180;
  const rot = (dx: number, dy: number) => {
    const t = rad(tilt);
    return { x: cx + dx * Math.cos(t) - dy * Math.sin(t), y: cy + dx * Math.sin(t) + dy * Math.cos(t) };
  };
  const ink = ACCENT;
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: ink, borderWidth: 1.8, opacity: 0 });
  page.drawCircle({ x: cx, y: cy, size: r * 0.66, borderColor: ink, borderWidth: 0.9, opacity: 0 });

  const arc = (str: string, radius: number, centerDeg: number, size: number, top: boolean) => {
    const t = toWinAnsi(str);
    const spacing = size * 0.18;
    const widths = [...t].map((ch) => fonts.bold.widthOfTextAtSize(ch, size) + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    let a = rad(centerDeg + tilt) + (top ? 1 : -1) * (total / radius) / 2;
    [...t].forEach((ch, i) => {
      const w = widths[i];
      const mid = a + (top ? -1 : 1) * (w - spacing) / 2 / radius;
      const ang = mid;
      // Put the glyph's left edge half its width back along the tangent so it centres on the arc point.
      const px = cx + radius * Math.cos(ang);
      const py = cy + radius * Math.sin(ang);
      const rotDeg = (ang * 180) / Math.PI + (top ? -90 : 90);
      const half = (w - spacing) / 2;
      const tx = Math.cos(rad(rotDeg)), ty = Math.sin(rad(rotDeg));
      page.drawText(ch, { x: px - tx * half, y: py - ty * half, size, font: fonts.bold, color: ink, rotate: degrees(rotDeg) });
      a += (top ? -1 : 1) * w / radius;
    });
  };
  arc(lines.top, r * 0.8, 90, r * 0.17, true);
  arc(lines.bottom, r * 0.8 + r * 0.12, 270, r * 0.12, false);

  // Sealed-page shield, upright relative to the tilt.
  const s = r / 48;
  // Shield outline, built from rotated points so it tilts with the ring (svg y runs down, so it is negated).
  const outline: [number, number][] = [[0, 31], [9.5, 27.5], [9.5, 20], [8, 15], [4.5, 11], [0, 8], [-4.5, 11], [-8, 15], [-9.5, 20], [-9.5, 27.5]];
  const pts = outline.map(([dx, dy]) => rot(dx * s, dy * s));
  page.drawSvgPath(`M ${pts.map((p) => `${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join(" L ")} Z`, {
    x: 0, y: 0, borderColor: ink, borderWidth: 1.3,
  });
  for (const [dx, dy, w] of [[-4.5, 24, 9], [-4.5, 20, 9], [-4.5, 16, 6]] as const) {
    const o = rot(dx * s, dy * s);
    page.drawLine({ start: o, end: { x: o.x + w * s * Math.cos(rad(tilt)), y: o.y + w * s * Math.sin(rad(tilt)) }, thickness: 1.6 * s, color: ink });
  }
  const centred = (str: string, dy: number, font: PDFFont, size: number) => {
    const t = toWinAnsi(str);
    const w = font.widthOfTextAtSize(t, size);
    const o = rot(-w / 2, dy);
    page.drawText(t, { x: o.x, y: o.y, size, font, color: ink, rotate: degrees(tilt) });
  };
  centred(lines.big, -6 * s, fonts.serif, 15 * s);
  centred(lines.date, -19 * s, fonts.bold, 6.6 * s);
}

export async function buildPrivacyReportPdf(
  report: PrivacyProcessingAndEgressReport16,
  opts: PdfReportOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("ClauseGuard privacy report");
  doc.setAuthor("ClauseGuard");
  doc.setCreator("ClauseGuard");
  doc.setProducer("ClauseGuard");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - M;
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const text = (s: string, x: number, yy: number, font: PDFFont, size: number, color = INK) =>
    page.drawText(toWinAnsi(s), { x, y: yy, font, size, color });
  const rightText = (s: string, xr: number, yy: number, font: PDFFont, size: number, color = INK) => {
    const t = toWinAnsi(s);
    page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, font, size, color });
  };
  const rule = (yy: number, color = RULE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: M + CW, y: yy }, thickness: 0.6, color });

  const drawParagraph = (s: string, font: PDFFont, size: number, color = INK, indent = 0, gap = 3) => {
    const lh = size * 1.4;
    for (const l of wrapText(s, font, size, CW - indent)) {
      ensure(lh);
      y -= lh;
      text(l, M + indent, y + size * 0.3, font, size, color);
    }
    y -= gap;
  };
  const heading = (s: string) => {
    ensure(46);
    y -= 14;
    text(s, M, y - 12, serif, 15, ACCENT);
    y -= 24;
  };
  const smallCaps = (s: string) => {
    ensure(40);
    y -= 12;
    text(s.toUpperCase(), M, y - 8, bold, 9, ACCENT);
    y -= 18;
  };

  const cloud = isCloudUsed(report);

  // Header band
  newPage();
  const sx = M, sy = y - 20;
  page.drawSvgPath("M 0 0 L 16 0 L 16 9 C 16 17 8 21 8 22 C 8 21 0 17 0 9 Z", { x: sx, y: sy + 22, color: ACCENT });
  for (const [yy, w] of [[16, 8], [12.5, 8], [9, 5.5]] as const) {
    page.drawLine({ start: { x: sx + 4, y: sy + yy }, end: { x: sx + 4 + w, y: sy + yy }, thickness: 1.6, color: rgb(1, 1, 1), opacity: yy === 12.5 ? 0.55 : 1 });
  }
  text("ClauseGuard privacy report", sx + 24, sy + 7, bold, 12, ACCENT);
  rightText(formatDate(report.generated_at_utc), M + CW, sy + 12, regular, 9, MUTED);
  rightText(`Report ${report.report_id}`, M + CW, sy + 1, regular, 9, MUTED);
  y = sy - 10;
  page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 1.6, color: ACCENT });
  y -= 14;

  // Title and verdict
  const SEAL_R = 50;
  const NARROW = CW - SEAL_R * 2 - 22;
  const sealTop = y;
  const title = opts.documentTitle?.trim() || "Your privacy report";
  for (const l of wrapText(title, serif, 24, NARROW)) {
    y -= 28;
    text(l, M, y + 6, serif, 24, INK);
  }
  y -= 4;
  for (const l of wrapText(verdictText(report), regular, 12.5, NARROW)) {
    y -= 17.5;
    text(l, M, y + 3.75, regular, 12.5, INK);
  }
  y -= 10;

  // KPI boxes
  const gap = 12;
  const bw = (NARROW - 2 * gap) / 3;
  const bh = 62;
  ensure(bh + 10);
  const kpis: [string, string, number][] = [
    [String(opts.hiddenTotal), "details hidden", 24],
    [String(opts.sentCount), "details sent", 24],
    [cloud ? "Device + cloud" : "This device", "where it was checked", 15],
  ];
  kpis.forEach(([big, label, size], i) => {
    const x = M + i * (bw + gap);
    page.drawRectangle({ x, y: y - bh, width: bw, height: bh, color: SOFT, borderColor: RULE, borderWidth: 0.5 });
    text(big, x + 12, y - 30, serif, size, ACCENT);
    text(label, x + 12, y - 48, regular, 9.5, MUTED);
  });
  y -= bh + 12;
  const sealCy = Math.min(sealTop - SEAL_R - 6, (sealTop + y) / 2);
  drawSeal(page, M + CW - SEAL_R - 4, sealCy, SEAL_R, { bold, serif }, {
    top: "CLAUSEGUARD",
    bottom: cloud ? "CHECKED ON DEVICE AND CLOUD" : "CHECKED ON THIS DEVICE",
    big: `${opts.hiddenTotal} kept`,
    date: sealDate(report.generated_at_utc),
  });
  y = Math.min(y, sealCy - SEAL_R - 12);

  // What was hidden
  smallCaps("What was hidden");
  if (opts.hiddenItems.length === 0) {
    drawParagraph("No details were hidden.", regular, 11, MUTED);
  } else {
    rule(y + 4);
    for (const item of opts.hiddenItems) {
      const lines = wrapText(item.label, regular, 11, CW - 70);
      const h = lines.length * 15 + 8;
      ensure(h);
      lines.forEach((l, i) => text(l, M, y - 15 * (i + 1) + 3, regular, 11));
      rightText(String(item.count), M + CW, y - 12, bold, 11);
      y -= h;
      rule(y + 4);
    }
    y -= 4;
  }

  // Findings
  smallCaps("What the check found");
  if (opts.findings.length === 0) {
    drawParagraph("No results yet.", regular, 11, MUTED);
  } else {
    for (const f of opts.findings) {
      const pill = PILL[f.severity] ?? PILL.LOW;
      const tx = M + 62;
      const tl = wrapText(f.title, bold, 11, CW - 62);
      const ml = wrapText(f.message, regular, 10.5, CW - 62);
      ensure(tl.length * 15 + ml.length * 14.5 + 14);
      const top = y;
      page.drawRectangle({ x: M + 8, y: top - 14, width: 34, height: 16, color: pill.bg });
      // rounded look: round caps from circles at both ends
      page.drawCircle({ x: M + 8, y: top - 6, size: 8, color: pill.bg });
      page.drawCircle({ x: M + 42, y: top - 6, size: 8, color: pill.bg });
      const lw = bold.widthOfTextAtSize(pill.label, 8.5);
      text(pill.label, M + 25 - lw / 2, top - 9, bold, 8.5, pill.fg);
      let yy = top;
      tl.forEach((l) => { yy -= 15; text(l, tx, yy + 4, bold, 11); });
      ml.forEach((l) => { yy -= 14.5; text(l, tx, yy + 4, regular, 10.5, MUTED); });
      y = Math.min(yy, top - 16) - 10;
    }
  }

  // Page 2: details
  newPage();
  heading("What we checked");
  const bullets = (items: string[]) => items.forEach((s) => {
    const lines = wrapText(s, regular, 11, CW - 14);
    lines.forEach((l, i) => {
      ensure(16);
      y -= 15;
      if (i === 0) text("•", M + 2, y + 4, regular, 11, ACCENT);
      text(l, M + 14, y + 4, regular, 11);
    });
    y -= 2;
  });
  bullets([
    "Your document was read and cleaned inside this browser tab.",
    "If the private check on this device could not run, nothing was sent to the cloud in its place.",
    cloud ? "The text that was sent matched the text you approved, exactly." : "No text was approved or sent.",
  ]);
  heading("What we could not check");
  bullets([
    "Browser add-ons that are allowed to read every page you open.",
    "Network traffic from other apps on this device.",
  ]);
  heading("Good to know");
  drawParagraph(
    "This report shows what ClauseGuard did with your document. It is not a legal or compliance certificate, and ClauseGuard does not give legal advice.",
    regular, 11,
  );
  heading("Technical appendix");
  const rows: [string, string][] = [
    ["Privacy mode", String(report.privacy_mode)],
    ["Redaction map version", String(report.redaction_map_version)],
    ["Approved text fingerprint", report.approved_payload_sha256 ?? "none"],
    ["Local inference source", report.local_inference_source],
    ["Cloud inference source", report.cloud_inference_source ?? "none"],
  ];
  rule(y + 4);
  for (const [k, v] of rows) {
    const vl = wrapText(v, mono, 8.5, CW - 170);
    const h = Math.max(1, vl.length) * 12 + 8;
    ensure(h);
    text(k, M, y - 13, regular, 10, MUTED);
    vl.forEach((l, i) => text(l, M + 170, y - 13 - i * 12, mono, 8.5));
    y -= h;
    rule(y + 4);
  }
  y -= 8;
  drawParagraph("Document fingerprint (SHA-256):", regular, 9, MUTED, 0, 1);
  drawParagraph(report.raw_document_sha256, mono, 8.5, INK, 0, 8);

  const grey = rgb(0.5, 0.5, 0.5);
  const list = (label: string, items: string[]) => {
    drawParagraph(label, bold, 8.5, grey, 0, 1);
    if (items.length === 0) drawParagraph("None.", regular, 8, grey);
    items.forEach((s) => drawParagraph(`- ${s}`, regular, 8, grey, 6, 1));
    y -= 4;
  };
  list("Checked:", report.verified_properties);
  list("Not checked:", report.unverified_external_properties);
  drawParagraph(report.known_limitations_and_non_certification_disclaimer, regular, 8, grey);

  // Footers
  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: FOOT_Y + 14 }, end: { x: M + CW, y: FOOT_Y + 14 }, thickness: 0.5, color: RULE });
    p.drawText("Not legal, medical or money advice.", { x: M, y: FOOT_Y, font: regular, size: 8.5, color: MUTED });
    const t = `Page ${i + 1} of ${total}`;
    p.drawText(t, { x: M + CW - regular.widthOfTextAtSize(t, 8.5), y: FOOT_Y, font: regular, size: 8.5, color: MUTED });
  });

  return doc.save();
}
