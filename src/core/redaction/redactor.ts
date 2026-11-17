import { sha256Hex } from "../ingestion/normalizer.ts";
import type { DetectedEntity, RedactionMapEntry, RedactionResult } from "../types.ts";

function deriveMagnitudeBand(surface: string): string {
  const num = Number(surface.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(num)) return "AMT";
  if (num >= 1_000_000) return "CAP_1M_PLUS";
  if (num >= 100_000) return "CAP_100K_1M";
  return "CAP_UNDER_100K";
}

/**
 * Execute Longest-Span-First Interval Resolution + Reverse-Offset Substitution
 * with Surface-Indexed Variant Tokens ([ENT_1], [ENT_1_V2]) for 100% lossless rehydration.
 */
export async function buildRedaction(
  normalizedText: string,
  entities: DetectedEntity[],
  mapVersion: number
): Promise<RedactionResult> {
  const accepted = entities.filter(
    (e) => e.reviewStatus === "ACCEPTED" && e.normStart >= 0 && e.normEnd <= normalizedText.length && e.normEnd > e.normStart
  );

  // Longest-span-first priority, breaking ties by earliest offset
  const sortedByLength = [...accepted].sort((a, b) => {
    const lenDiff = b.normEnd - b.normStart - (a.normEnd - a.normStart);
    return lenDiff !== 0 ? lenDiff : a.normStart - b.normStart;
  });

  const nonOverlapping: DetectedEntity[] = [];
  for (const cand of sortedByLength) {
    const overlaps = nonOverlapping.some(
      (acc) => !(cand.normEnd <= acc.normStart || cand.normStart >= acc.normEnd)
    );
    if (!overlaps) {
      nonOverlapping.push(cand);
    }
  }

  // Assign stable surface-indexed tokens grouped by canonicalKey + role
  const canonicalOrder = new Map<string, number>();
  const variantSurfaces = new Map<string, string[]>();
  let groupSeq = 1;

  const entriesAsc: RedactionMapEntry[] = [...nonOverlapping]
    .sort((a, b) => a.normStart - b.normStart)
    .map((ent) => {
      const groupKey = `${ent.category}:${ent.canonicalKey}:${ent.role}`;
      if (!canonicalOrder.has(groupKey)) {
        canonicalOrder.set(groupKey, groupSeq++);
      }
      const grpNum = canonicalOrder.get(groupKey)!;
      const basePrefix =
        ent.category === "CURRENCY_CAP"
          ? `${deriveMagnitudeBand(ent.surface)}_${grpNum}`
          : `${ent.category}_${ent.role}_${grpNum}`;
      const baseToken = `[${basePrefix}]`;

      const seenSurfaces = variantSurfaces.get(groupKey) ?? [];
      let vIdx = seenSurfaces.indexOf(ent.surface);
      if (vIdx === -1) {
        seenSurfaces.push(ent.surface);
        variantSurfaces.set(groupKey, seenSurfaces);
        vIdx = seenSurfaces.length - 1;
      }
      const variantNum = vIdx + 1;
      const token = variantNum === 1 ? baseToken : `[${basePrefix}_V${variantNum}]`;

      return {
        token,
        baseToken,
        variantIndex: variantNum,
        canonicalKey: ent.canonicalKey,
        originalSurface: ent.surface,
        category: ent.category,
        role: ent.role,
        normStart: ent.normStart,
        normEnd: ent.normEnd,
      };
    });

  // Reverse-offset substitution prevents shifting downstream indices
  let redacted = normalizedText;
  const descOffsets = [...entriesAsc].sort((a, b) => b.normStart - a.normStart);
  const tokenToSurface: Record<string, string> = {};
  for (const entry of descOffsets) {
    redacted =
      redacted.slice(0, entry.normStart) + entry.token + redacted.slice(entry.normEnd);
    tokenToSurface[entry.token] = entry.originalSurface;
  }

  const sanitizedSha256 = await sha256Hex(redacted);
  return {
    sanitizedText: redacted,
    sanitizedSha256,
    entries: entriesAsc,
    tokenToSurface,
    mapVersion,
  };
}

/**
 * Losslessly rehydrate anonymized text strictly on the local device.
 * Flags any hallucinated/forged tokens not present in the local map as [UNMAPPED_TOKEN:...].
 */
export function rehydrateText(
  anonymizedText: string,
  tokenToSurface: Record<string, string>
): { rehydratedText: string; unmappedTokens: string[] } {
  const tokenPattern = /\[[A-Z0-9_]{3,64}\]/g;
  const unmapped = new Set<string>();
  const rehydratedText = anonymizedText.replace(tokenPattern, (tok) => {
    if (Object.prototype.hasOwnProperty.call(tokenToSurface, tok)) {
      return tokenToSurface[tok];
    }
    // Check case-insensitive fallback without touching forged tokens
    const ciKey = Object.keys(tokenToSurface).find(
      (k) => k.toLowerCase() === tok.toLowerCase()
    );
    if (ciKey) {
      return tokenToSurface[ciKey];
    }
    unmapped.add(tok);
    return `[UNMAPPED_TOKEN:${tok.slice(1, -1)}]`;
  });
  return { rehydratedText, unmappedTokens: Array.from(unmapped) };
}
