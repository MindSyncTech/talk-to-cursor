import { describe, expect, it } from "vitest";
import { fluidVoiceShortcutToHotkey, hotkeyFromFluidVoicePreferences } from "../src/fluidvoice.js";

const plistWith = (key: string, value: unknown) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>${key}</key>
  <data>
  ${Buffer.from(JSON.stringify(value)).toString("base64")}
  </data>
</dict></plist>`;

describe("FluidVoice shortcut import", () => {
  it("converts key and modifier combinations", () => {
    expect(fluidVoiceShortcutToHotkey({ kind: "keyboard", keyCode: 2, modifierFlagsRawValue: 1 << 18 })).toBe("ctrl+d");
    expect(fluidVoiceShortcutToHotkey({ kind: "keyboard", keyCode: 2, modifierFlagsRawValue: (1 << 18) | (1 << 20) })).toBe("ctrl+cmd+d");
    expect(fluidVoiceShortcutToHotkey({ kind: "keyboard", keyCode: 49, modifierFlagsRawValue: (1 << 19) | 0x40 })).toBe("right_option+space");
  });

  it("converts modifier-only shortcuts without repeating the modifier", () => {
    expect(fluidVoiceShortcutToHotkey({ kind: "keyboard", keyCode: 61, modifierFlagsRawValue: (1 << 19) | 0x40 })).toBe("right_option");
    expect(fluidVoiceShortcutToHotkey({ kind: "keyboard", keyCode: 61, modifierFlagsRawValue: 0 })).toBe("right_option");
  });

  it("rejects shortcuts it can't press", () => {
    expect(fluidVoiceShortcutToHotkey({ kind: "mouse", keyCode: 2 })).toBeNull();
    expect(fluidVoiceShortcutToHotkey({ kind: "keyboard", keyCode: 63 })).toBeNull();
  });

  it("reads the primary dictation shortcut, falling back to the legacy key", () => {
    expect(hotkeyFromFluidVoicePreferences(plistWith("PrimaryDictationShortcuts", [
      { modifierFlagsRawValue: 262144, kind: "keyboard", keyCode: 2 },
    ]))).toBe("ctrl+d");
    expect(hotkeyFromFluidVoicePreferences(plistWith("HotkeyShortcutKey", { kind: "keyboard", keyCode: 61 }))).toBe("right_option");
    expect(hotkeyFromFluidVoicePreferences("<plist><dict></dict></plist>")).toBeNull();
  });
});
