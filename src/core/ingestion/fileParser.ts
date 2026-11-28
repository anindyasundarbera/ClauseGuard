import JSZip from "jszip";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { NormalizedDocument } from "../types.ts";
import { normalizeDocumentPages, type RawPageInput } from "./normalizer.ts";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PDF_PAGES = 50;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // Zip-bomb defense
export const MIN_DIGITAL_CHARS_PER_PAGE = 100;

export class IngestionError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "IngestionError";
  }
}

/** Decode XML entities safely without DOM HTML execution. */
function decodeXmlEntities(xmlText: string): string {
  return xmlText
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Extract paragraphs from WordprocessingML XML safely without evaluating scripts. */
export function extractTextFromWordXml(xml: string): string {
  const withParagraphs = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(withParagraphs)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parse a local .docx archive with zip-bomb decompression bounds. */
export async function parseDocxBytes(
  fileName: string,
  bytes: Uint8Array
): Promise<NormalizedDocument> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new IngestionError("ERR_FILE_TOO_LARGE", `DOCX exceeds ${MAX_DOCUMENT_BYTES} byte limit.`);
  }
  const zip = await JSZip.loadAsync(bytes);
  const targetEntries = Object.keys(zip.files)
    .filter(
      (k) =>
        k === "word/document.xml" ||
        /^word\/header\d*\.xml$/.test(k) ||
        /^word\/footer\d*\.xml$/.test(k) ||
        k === "word/comments.xml"
    )
    .sort();

  if (targetEntries.length === 0) {
    throw new IngestionError("ERR_MALFORMED_DOCX", "Archive lacks word/document.xml.");
  }

  let totalUncompressed = 0;
  const pages: RawPageInput[] = [];
  let idx = 1;
  for (const name of targetEntries) {
    const xml = await zip.files[name].async("string");
    totalUncompressed += xml.length;
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new IngestionError(
        "ERR_ZIP_BOMB_GUARD",
        "DOCX uncompressed XML exceeded 50 MB decompression ceiling."
      );
    }
    const text = extractTextFromWordXml(xml);
    if (text) {
      pages.push({ page: idx++, sectionLabel: name, text });
    }
  }
  if (pages.length === 0) {
    throw new IngestionError("ERR_EMPTY_DOCX", "No readable text found inside DOCX parts.");
  }

  return normalizeDocumentPages(
    `DOC-${Date.now()}`,
    fileName,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pages,
    { metadataStripped: true }
  );
}

/** Parse a local digital PDF via pdfjs-dist with isEvalSupported strictly false and XMP stripped. */
export async function parsePdfBytes(
  fileName: string,
  bytes: Uint8Array
): Promise<NormalizedDocument> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new IngestionError("ERR_FILE_TOO_LARGE", `PDF exceeds ${MAX_DOCUMENT_BYTES} byte limit.`);
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const isNodeEnv =
    typeof process !== "undefined" && Boolean(process.versions && process.versions.node);
  if (!isNodeEnv && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new IngestionError(
        "ERR_PDF_PAGE_LIMIT",
        `PDF has ${pdf.numPages} pages; MVP hard cap is ${MAX_PDF_PAGES} pages.`
      );
    }

    const pages: RawPageInput[] = [];
    const scannedPages: number[] = [];

    for (let pNum = 1; pNum <= pdf.numPages; pNum++) {
      const page = await pdf.getPage(pNum);
      const content = await page.getTextContent();
      let hiddenTextCount = 0;
      const items = (content.items as Array<{ str?: string; transform?: number[]; height?: number; width?: number }>)
        .map((it) => {
          const text = it.str ?? "";
          const h = Math.abs(it.height ?? it.transform?.[3] ?? 10);
          if (text.trim().length > 0 && h < 1.0) {
            hiddenTextCount++;
          }
          return {
            text,
            x: it.transform?.[4] ?? 0,
            y: it.transform?.[5] ?? 0,
            w: it.width ?? 0,
            h,
          };
        })
        .sort((a, b) => (Math.abs(b.y - a.y) > 4 ? b.y - a.y : a.x - b.x));

      // Keep the page layout where it matters for forms: a wide horizontal gap (a table column)
      // becomes a tab, and a line that stops well short of the right margin ends with a line
      // break. Lines that run to the margin are wrapped prose and are joined with a space, so a
      // name or company split across a wrap is still one phrase. Field detectors use the tabs and
      // breaks to tell where a value ends ("Dr. A   Gender : M" is not read as one name).
      const rightEdge = items.reduce((mx, it) => Math.max(mx, it.x + it.w), 0);
      const leftEdge = items.reduce((mn, it) => Math.min(mn, it.x), Number.POSITIVE_INFINITY);
      const wrapThreshold = leftEdge + (rightEdge - leftEdge) * 0.75;
      let pageText = "";
      let prev: (typeof items)[number] | null = null;
      for (const it of items) {
        if (prev) {
          const newLine = Math.abs(prev.y - it.y) > 4;
          const gap = it.x - (prev.x + prev.w);
          if (newLine) {
            pageText += prev.w > 0 && prev.x + prev.w < wrapThreshold ? "\n" : " ";
          } else {
            pageText += prev.w > 0 && gap > Math.max(12, prev.h * 2) ? "\t" : " ";
          }
        }
        pageText += it.text;
        prev = it;
      }
      pageText = pageText
        .replace(/[ ]{2,}/g, " ")
        .replace(/[ ]*([\t\n])[ ]*/g, "$1")
        .replace(/\t{2,}/g, "\t")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (pageText.length < MIN_DIGITAL_CHARS_PER_PAGE) {
        scannedPages.push(pNum);
      }
      pages.push({
        page: pNum,
        sectionLabel: `PDF Page ${pNum}`,
        text: pageText,
        hiddenTextCount,
      });
    }

    if (scannedPages.length === pdf.numPages && pages.every((p) => p.text.length < MIN_DIGITAL_CHARS_PER_PAGE)) {
      throw new IngestionError(
        "ERR_SCAN_DETECTED_OCR_EXCLUDED",
        `All ${pdf.numPages} PDF pages contain < ${MIN_DIGITAL_CHARS_PER_PAGE} extractable characters. Scanned PDF OCR is explicitly excluded from the MVP.`
      );
    }

    return normalizeDocumentPages(`DOC-${Date.now()}`, fileName, "application/pdf", pages, {
      metadataStripped: true,
      scannedPages,
    });
  } finally {
    await loadingTask.destroy();
  }
}

/** Parse plain UTF-8 contract text safely within byte bounds. */
export async function parsePlainText(
  fileName: string,
  text: string
): Promise<NormalizedDocument> {
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) {
    throw new IngestionError("ERR_FILE_TOO_LARGE", `Text input exceeds ${MAX_DOCUMENT_BYTES} bytes.`);
  }
  if (!text.trim()) {
    throw new IngestionError("ERR_EMPTY_DOCUMENT", "Document contains no readable text.");
  }
  return normalizeDocumentPages(`DOC-${Date.now()}`, fileName, "text/plain", [
    { page: 1, sectionLabel: "Full Document", text },
  ], { metadataStripped: true });
}
