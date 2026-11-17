import type { NormalizedDocument, SourceMapSegment } from "../types.ts";

const INVISIBLE_CHAR_REGEX = /[\u200B-\u200D\u00AD\uFEFF\u2060\u180E]/g;
const TAG_BLOCK_REGEX = /[\u{E0000}-\u{E007F}]/gu;

/** Compute SHA-256 hex digest of UTF-8 text using standard WebCrypto SubtleCrypto. */
export async function sha256Hex(text: string): Promise<string> {
  return sha256BytesHex(new TextEncoder().encode(text));
}

/** Compute SHA-256 hex digest of raw binary bytes directly without UTF-8 truncation or spread limits. */
export async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Detect mixed-script homoglyphs (e.g., Cyrillic lookalikes inside Latin tokens). */
export function detectHomoglyphTokens(text: string): string[] {
  const warnings: string[] = [];
  const words = text.split(/\s+/);
  for (const w of words) {
    const hasLatin = /[A-Za-z]/.test(w);
    const hasNonLatinScript = /[\u0400-\u04FF\u0370-\u03FF]/.test(w);
    if (hasLatin && hasNonLatinScript) {
      warnings.push(w.slice(0, 48));
    }
  }
  return Array.from(new Set(warnings));
}

export interface RawPageInput {
  page: number;
  sectionLabel: string;
  text: string;
  hiddenTextCount?: number;
}

/**
 * Produce NFKC-normalized text with invisible Cf characters stripped while
 * preserving exact SourceMap provenance back to original page & offsets.
 */
export async function normalizeDocumentPages(
  docId: string,
  fileName: string,
  mimeType: string,
  pages: RawPageInput[],
  opts: { metadataStripped: boolean; scannedPages?: number[] }
): Promise<NormalizedDocument> {
  const sourceMap: SourceMapSegment[] = [];
  const normParts: string[] = [];
  const hiddenTextWarnings: string[] = [];
  let rawCharCount = 0;
  let strippedInvisibleCount = 0;
  let normCursor = 0;
  let origCursor = 0;

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const separator = i > 0 ? "\n\n" : "";
    if (separator) {
      normParts.push(separator);
      normCursor += separator.length;
    }

    rawCharCount += pg.text.length;
    if ((pg.hiddenTextCount ?? 0) > 0) {
      hiddenTextWarnings.push(
        `Page ${pg.page}: detected ${pg.hiddenTextCount} near-zero/invisible font text items (flagged for manual review).`
      );
    }

    const nfkc = pg.text.normalize("NFKC");
    const withoutTags = nfkc.replace(TAG_BLOCK_REGEX, "");
    const cleaned = withoutTags.replace(INVISIBLE_CHAR_REGEX, "");
    strippedInvisibleCount += nfkc.length - cleaned.length;

    const normStart = normCursor;
    const normEnd = normStart + cleaned.length;
    sourceMap.push({
      normStart,
      normEnd,
      origStart: origCursor,
      origEnd: origCursor + pg.text.length,
      page: pg.page,
      sectionLabel: pg.sectionLabel,
    });
    normParts.push(cleaned);
    normCursor = normEnd;
    origCursor += pg.text.length;
  }

  const normalizedText = normParts.join("");
  const normalizedSha256 = await sha256Hex(normalizedText);
  const homoglyphWarnings = detectHomoglyphTokens(normalizedText);

  return {
    docId,
    fileName,
    mimeType,
    rawCharCount,
    normalizedText,
    normalizedSha256,
    strippedInvisibleCount,
    homoglyphWarnings,
    hiddenTextWarnings,
    metadataStripped: opts.metadataStripped,
    pageCount: pages.length,
    scannedPages: opts.scannedPages ?? [],
    sourceMap,
  };
}

/** Resolve normalized offset back to page and section context. */
export function lookupSourceLocation(
  sourceMap: SourceMapSegment[],
  normStart: number
): { page: number; sectionLabel: string } {
  for (const seg of sourceMap) {
    if (normStart >= seg.normStart && normStart <= seg.normEnd) {
      return { page: seg.page, sectionLabel: seg.sectionLabel };
    }
  }
  return sourceMap[0]
    ? { page: sourceMap[0].page, sectionLabel: sourceMap[0].sectionLabel }
    : { page: 1, sectionLabel: "Document" };
}
