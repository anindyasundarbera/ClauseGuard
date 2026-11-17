import { describe, expect, it } from "vitest";
import { lookupSourceLocation, normalizeDocumentPages } from "../../src/core/ingestion/normalizer.ts";
import { buildRedaction, rehydrateText } from "../../src/core/redaction/redactor.ts";
import type { DetectedEntity } from "../../src/core/types.ts";

describe("Normalizer, SourceMap & Longest-Span-First Surface-Indexed Redactor", () => {
  it("strips zero-width Cf characters, detects mixed-script homoglyphs, and preserves SourceMap", async () => {
    const doc = await normalizeDocumentPages(
      "DOC-N1",
      "contract.txt",
      "text/plain",
      [
        { page: 1, sectionLabel: "Preamble", text: "Agreement with Mer\u200bidian Robotics." },
        { page: 2, sectionLabel: "Schedule A", text: "Homoglyph test: Merc\u0430ntile Corp." },
      ],
      { metadataStripped: true }
    );

    expect(doc.strippedInvisibleCount).toBe(1);
    expect(doc.normalizedText).toContain("Meridian Robotics");
    expect(doc.homoglyphWarnings).toContain("Merc\u0430ntile");
    const loc2 = lookupSourceLocation(doc.sourceMap, doc.normalizedText.indexOf("Merc\u0430ntile"));
    expect(loc2.page).toBe(2);
    expect(loc2.sectionLabel).toBe("Schedule A");
  });

  it("prevents substring corruption on nested spans and rehydrates _V2 surface variants 100% losslessly", async () => {
    const text =
      "Meridian Precision Robotics GmbH ('MPR') grants license to Meridian. Repeat: MPR and Meridian Precision Robotics GmbH.";
    const entities: DetectedEntity[] = [
      {
        id: "1",
        surface: "Meridian",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: 0,
        normEnd: 8,
        source: "WORKSPACE_GRAPH",
        confidence: 0.9,
        rationale: "Short prefix",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "2",
        surface: "Meridian Precision Robotics GmbH",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: 0,
        normEnd: 32,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.98,
        rationale: "Full legal entity",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "3",
        surface: "MPR",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: 35,
        normEnd: 38,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.95,
        rationale: "Alias",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "4",
        surface: "Meridian",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: 59,
        normEnd: 67,
        source: "WORKSPACE_GRAPH",
        confidence: 0.95,
        rationale: "Short variant",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "5",
        surface: "MPR",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: 77,
        normEnd: 80,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.95,
        rationale: "Alias",
        reviewStatus: "ACCEPTED",
      },
      {
        id: "6",
        surface: "Meridian Precision Robotics GmbH",
        canonicalKey: "ENT-MPR",
        canonicalName: "Meridian Precision Robotics GmbH",
        category: "ORG",
        role: "CLIENT",
        normStart: 85,
        normEnd: 117,
        source: "PREAMBLE_DEFINITION",
        confidence: 0.98,
        rationale: "Full legal entity",
        reviewStatus: "ACCEPTED",
      },
    ];

    const red = await buildRedaction(text, entities, 1);
    expect(red.sanitizedText).not.toContain("Meridian");
    expect(red.sanitizedText).not.toContain("MPR");
    expect(red.sanitizedText).toContain("[ORG_CLIENT_1]");
    expect(red.sanitizedText).toContain("[ORG_CLIENT_1_V2]");
    expect(red.sanitizedText).toContain("[ORG_CLIENT_1_V3]");

    const reh = rehydrateText(red.sanitizedText, red.tokenToSurface);
    expect(reh.rehydratedText).toBe(text);
    expect(reh.unmappedTokens).toEqual([]);
  });

  it("flags forged or unknown cloud placeholders explicitly as [UNMAPPED_TOKEN:...]", () => {
    const res = rehydrateText("Party [ORG_CLIENT_1] and forged [ORG_CLIENT_999] risk.", {
      "[ORG_CLIENT_1]": "Meridian GmbH",
    });
    expect(res.rehydratedText).toBe("Party Meridian GmbH and forged [UNMAPPED_TOKEN:ORG_CLIENT_999] risk.");
    expect(res.unmappedTokens).toEqual(["[ORG_CLIENT_999]"]);
  });

  it("fuzzes randomized overlapping span intervals without corrupting adjacent text", async () => {
    for (let trial = 0; trial < 25; trial++) {
      const base = `Clause ${trial}: Alpha Beta Gamma Corp vs Delta Epsilon LLC at Sector ${trial} End.`;
      const alphaIdx = base.indexOf("Alpha Beta Gamma Corp");
      const betaIdx = base.indexOf("Beta Gamma");
      const deltaIdx = base.indexOf("Delta Epsilon LLC");
      const spans: DetectedEntity[] = [
        {
          id: "a",
          surface: "Alpha Beta Gamma Corp",
          canonicalKey: "K1",
          canonicalName: "Alpha Beta Gamma Corp",
          category: "ORG",
          role: "CLIENT",
          normStart: alphaIdx,
          normEnd: alphaIdx + "Alpha Beta Gamma Corp".length,
          source: "DETERMINISTIC_L1",
          confidence: 0.9,
          rationale: "fuzz",
          reviewStatus: "ACCEPTED",
        },
        {
          id: "b",
          surface: "Beta Gamma",
          canonicalKey: "K1",
          canonicalName: "Alpha Beta Gamma Corp",
          category: "ORG",
          role: "CLIENT",
          normStart: betaIdx,
          normEnd: betaIdx + "Beta Gamma".length,
          source: "DETERMINISTIC_L1",
          confidence: 0.8,
          rationale: "fuzz-overlap",
          reviewStatus: "ACCEPTED",
        },
        {
          id: "c",
          surface: "Delta Epsilon LLC",
          canonicalKey: "K2",
          canonicalName: "Delta Epsilon LLC",
          category: "ORG",
          role: "VENDOR",
          normStart: deltaIdx,
          normEnd: deltaIdx + "Delta Epsilon LLC".length,
          source: "DETERMINISTIC_L1",
          confidence: 0.9,
          rationale: "fuzz",
          reviewStatus: "ACCEPTED",
        },
      ];
      const red = await buildRedaction(base, spans, trial + 1);
      expect(red.sanitizedText).not.toContain("Alpha");
      expect(red.sanitizedText).not.toContain("Delta");
      const reh = rehydrateText(red.sanitizedText, red.tokenToSurface);
      expect(reh.rehydratedText).toBe(base);
    }
  });
});
