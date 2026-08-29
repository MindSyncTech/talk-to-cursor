import { describe, expect, it } from "vitest";
import { segmentSentences } from "../src/sentence-segmentation.js";

describe("segmentSentences", () => {
  it("preserves decimals and semantic versions", () => {
    expect(
      segmentSentences(
        "Updated to version 1.2.0. The threshold remains 0.75. Done.",
      ),
    ).toEqual([
      "Updated to version 1.2.0.",
      "The threshold remains 0.75.",
      "Done.",
    ]);
  });

  it("recognizes sentences without terminal punctuation", () => {
    expect(segmentSentences("First sentence. Final fragment")).toEqual([
      "First sentence.",
      "Final fragment",
    ]);
  });
});
