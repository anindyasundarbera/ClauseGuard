import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  IngestionError,
  MAX_DOCUMENT_BYTES,
  parseDocxBytes,
  parsePdfBytes,
  parsePlainText,
} from "../../src/core/ingestion/fileParser.ts";

/** Build a minimal valid PDF-1.4 byte buffer with wrapped lines inside MediaBox [0 0 612 792]. */
function buildMinimalPdfBytes(bodyText: string): Uint8Array {
  const safeText = bodyText.replace(/[()\\]/g, "");
  const lines = safeText.match(/.{1,55}(?:\s|$)/g) ?? [safeText];
  const ops = lines
    .map((ln, idx) => `${idx === 0 ? "72 720 Td" : "0 -18 Td"}\n(${ln.trim()}) Tj`)
    .join("\n");
  const stream = `BT\n/F1 12 Tf\n${ops}\nET\n`;
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objs) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("Local File Parser & Hostile File Boundaries", () => {
  it("parses real digital PDF via pdfjs-dist (isEvalSupported:false) and rejects scanned low-text PDFs", async () => {
    const digitalPdf = buildMinimalPdfBytes(
      "MASTER SERVICES AGREEMENT between Meridian Precision Robotics GmbH and Northstar Strategic Advisory LLC dated 2026-11-17 exceeding minimum digital density threshold."
    );
    const doc = await parsePdfBytes("contract.pdf", digitalPdf);
    expect(doc.pageCount).toBe(1);
    expect(doc.metadataStripped).toBe(true);
    expect(doc.normalizedText).toContain("Meridian Precision Robotics GmbH");

    const scanPdf = buildMinimalPdfBytes("Tiny");
    await expect(parsePdfBytes("scan.pdf", scanPdf)).rejects.toThrow(/ERR_SCAN_DETECTED_OCR_EXCLUDED/);
  });
  it("parses valid .docx paragraphs, headers, and comments locally via jszip", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document><w:body><w:p><w:r><w:t>Agreement between Meridian GmbH &amp; Northstar LLC.</w:t></w:r></w:p></w:body></w:document>`
    );
    zip.file(
      "word/header1.xml",
      `<w:hdr><w:p><w:r><w:t>CONFIDENTIAL DRAFT HEADER</w:t></w:r></w:p></w:hdr>`
    );
    zip.file(
      "word/comments.xml",
      `<w:comments><w:comment><w:p><w:r><w:t>Reviewer note: Check Clause 14.1 cap.</w:t></w:r></w:p></w:comment></w:comments>`
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const doc = await parseDocxBytes("contract.docx", bytes);
    expect(doc.metadataStripped).toBe(true);
    expect(doc.normalizedText).toContain("Agreement between Meridian GmbH & Northstar LLC.");
    expect(doc.normalizedText).toContain("CONFIDENTIAL DRAFT HEADER");
    expect(doc.normalizedText).toContain("Reviewer note: Check Clause 14.1 cap.");
  });

  it("rejects malformed DOCX without word/document.xml and rejects oversized text files", async () => {
    const badZip = new JSZip();
    badZip.file("not_word.txt", "hello");
    const badBytes = await badZip.generateAsync({ type: "uint8array" });
    await expect(parseDocxBytes("bad.docx", badBytes)).rejects.toThrow(IngestionError);

    const oversized = "A".repeat(MAX_DOCUMENT_BYTES + 10);
    await expect(parsePlainText("huge.txt", oversized)).rejects.toThrow(/ERR_FILE_TOO_LARGE/);
  });

  it("rejects empty text inputs cleanly", async () => {
    await expect(parsePlainText("empty.txt", "   \n  ")).rejects.toThrow(/ERR_EMPTY_DOCUMENT/);
  });
});
