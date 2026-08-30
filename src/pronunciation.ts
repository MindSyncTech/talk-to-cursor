import type { Config } from "./settings-schema.js";

type PronunciationSettings = Config["pronunciation"];

interface Replacement {
  start: number;
  end: number;
  speak: string;
}

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/gu;

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARACTERS, "\\$&");
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function overlaps(
  candidate: Pick<Replacement, "start" | "end">,
  replacements: Replacement[],
): boolean {
  return replacements.some(
    (replacement) =>
      candidate.start < replacement.end && candidate.end > replacement.start,
  );
}

export function applyPronunciation(
  text: string,
  pronunciation: PronunciationSettings,
): string {
  if (!pronunciation.enabled || pronunciation.entries.length === 0 || !text) {
    return text;
  }

  const replacements: Replacement[] = [];
  const entries = pronunciation.entries
    .filter((entry) => entry.enabled)
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        Array.from(right.entry.match).length -
          Array.from(left.entry.match).length ||
        compareIds(left.entry.id, right.entry.id) ||
        left.index - right.index,
    );

  for (const { entry } of entries) {
    const literal = escapeRegExp(entry.match);
    const source =
      entry.matchMode === "word"
        ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`
        : literal;
    const matcher = new RegExp(source, entry.caseSensitive ? "gu" : "giu");

    for (const match of text.matchAll(matcher)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!overlaps({ start, end }, replacements)) {
        replacements.push({ start, end, speak: entry.speak });
      }
    }
  }

  if (replacements.length === 0) return text;
  replacements.sort((left, right) => left.start - right.start);

  let result = "";
  let cursor = 0;
  for (const replacement of replacements) {
    result += text.slice(cursor, replacement.start);
    result += replacement.speak;
    cursor = replacement.end;
  }
  return result + text.slice(cursor);
}
