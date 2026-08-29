const sentenceSegmenter = new Intl.Segmenter("en", {
  granularity: "sentence",
});

export function segmentSentences(text: string): string[] {
  return Array.from(
    sentenceSegmenter.segment(text),
    ({ segment }) => segment.trim(),
  ).filter(Boolean);
}
