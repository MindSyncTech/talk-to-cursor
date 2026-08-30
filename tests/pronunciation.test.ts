import { describe, expect, it } from "vitest";
import { applyPronunciation } from "../src/pronunciation.js";
import type { Config } from "../src/config.js";

type Pronunciation = Config["pronunciation"];

const ids = {
  first: "00000000-0000-4000-8000-000000000001",
  second: "00000000-0000-4000-8000-000000000002",
  third: "00000000-0000-4000-8000-000000000003",
};

function pronunciation(
  entries: Pronunciation["entries"],
  enabled = true,
): Pronunciation {
  return { enabled, entries };
}

describe("applyPronunciation", () => {
  it("prioritizes longer matches and then IDs for overlapping matches", () => {
    expect(
      applyPronunciation(
        "SQL Server uses SQL. abcde",
        pronunciation([
          {
            id: ids.third,
            match: "SQL",
            speak: "sequel",
            matchMode: "word",
            caseSensitive: false,
            enabled: true,
          },
          {
            id: ids.second,
            match: "SQL Server",
            speak: "sequel server",
            matchMode: "word",
            caseSensitive: false,
            enabled: true,
          },
          {
            id: ids.second,
            match: "bcd",
            speak: "second",
            matchMode: "substring",
            caseSensitive: true,
            enabled: true,
          },
          {
            id: ids.first,
            match: "abc",
            speak: "first",
            matchMode: "substring",
            caseSensitive: true,
            enabled: true,
          },
        ]),
      ),
    ).toBe("sequel server uses sequel. firstde");
  });

  it("uses Unicode letter, number, and underscore word boundaries", () => {
    expect(
      applyPronunciation(
        "café CAFÉ caféine 2café _café café_",
        pronunciation([
          {
            id: ids.first,
            match: "café",
            speak: "ka-fay",
            matchMode: "word",
            caseSensitive: false,
            enabled: true,
          },
        ]),
      ),
    ).toBe("ka-fay ka-fay caféine 2café _café café_");
  });

  it("matches metacharacters literally and does not reprocess output", () => {
    expect(
      applyPronunciation(
        "C++ A B",
        pronunciation([
          {
            id: ids.first,
            match: "C++",
            speak: "see plus plus",
            matchMode: "substring",
            caseSensitive: true,
            enabled: true,
          },
          {
            id: ids.second,
            match: "A",
            speak: "B",
            matchMode: "word",
            caseSensitive: true,
            enabled: true,
          },
          {
            id: ids.third,
            match: "B",
            speak: "C",
            matchMode: "word",
            caseSensitive: true,
            enabled: true,
          },
        ]),
      ),
    ).toBe("see plus plus B C");
  });

  it("ignores disabled dictionaries and entries", () => {
    const entries: Pronunciation["entries"] = [
      {
        id: ids.first,
        match: "API",
        speak: "A P I",
        matchMode: "word",
        caseSensitive: false,
        enabled: false,
      },
    ];
    expect(applyPronunciation("API", pronunciation(entries))).toBe("API");
    expect(applyPronunciation("API", pronunciation(entries, false))).toBe("API");
  });
});
