import { execFile } from "child_process";

const FLUIDVOICE_DEFAULTS_DOMAIN = "com.FluidApp.app";

const MODIFIER_KEY_CODES: Record<number, string> = {
  54: "right_cmd",
  55: "cmd",
  56: "shift",
  58: "option",
  59: "ctrl",
  60: "right_shift",
  61: "right_option",
  62: "right_ctrl",
};

const KEY_CODES: Record<number, string> = {
  0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v",
  11: "b", 12: "q", 13: "w", 14: "e", 15: "r", 16: "y", 17: "t",
  18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7",
  27: "-", 28: "8", 29: "0", 30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p",
  36: "enter", 37: "l", 38: "j", 39: "'", 40: "k", 41: ";", 42: "\\", 43: ",",
  44: "/", 45: "n", 46: "m", 47: ".", 48: "tab", 49: "space", 50: "`",
  51: "backspace", 53: "esc",
  96: "f5", 97: "f6", 98: "f7", 99: "f3", 100: "f8", 101: "f9", 103: "f11",
  109: "f10", 111: "f12", 115: "home", 116: "page_up", 117: "delete", 118: "f4",
  119: "end", 120: "f2", 121: "page_down", 122: "f1",
  123: "left", 124: "right", 125: "down", 126: "up",
};

// NSEvent device-independent flags, then device-dependent left/right bits.
const FLAG_CONTROL = 1 << 18;
const FLAG_SHIFT = 1 << 17;
const FLAG_OPTION = 1 << 19;
const FLAG_COMMAND = 1 << 20;
const DEVICE_RIGHT_CONTROL = 0x2000;
const DEVICE_RIGHT_SHIFT = 0x4;
const DEVICE_RIGHT_OPTION = 0x40;
const DEVICE_RIGHT_COMMAND = 0x10;

interface FluidVoiceShortcut {
  kind?: string;
  keyCode?: number;
  modifierFlagsRawValue?: number;
}

export function fluidVoiceShortcutToHotkey(shortcut: FluidVoiceShortcut): string | null {
  if (shortcut.kind && shortcut.kind !== "keyboard") return null;
  if (typeof shortcut.keyCode !== "number") return null;
  const flags = shortcut.modifierFlagsRawValue ?? 0;
  const modifierKey = MODIFIER_KEY_CODES[shortcut.keyCode];
  const key = modifierKey ?? KEY_CODES[shortcut.keyCode];
  if (!key) return null;

  const parts: string[] = [];
  const add = (flag: number, rightBit: number, left: string, right: string) => {
    if (!(flags & flag)) return;
    const name = flags & rightBit ? right : left;
    if (modifierKey && left === modifierKey.replace("right_", "")) return;
    parts.push(name);
  };
  add(FLAG_CONTROL, DEVICE_RIGHT_CONTROL, "ctrl", "right_ctrl");
  add(FLAG_SHIFT, DEVICE_RIGHT_SHIFT, "shift", "right_shift");
  add(FLAG_OPTION, DEVICE_RIGHT_OPTION, "option", "right_option");
  add(FLAG_COMMAND, DEVICE_RIGHT_COMMAND, "cmd", "right_cmd");
  parts.push(key);
  return parts.join("+");
}

export function hotkeyFromFluidVoicePreferences(plistXml: string): string | null {
  for (const name of ["PrimaryDictationShortcuts", "HotkeyShortcutKey"]) {
    const match = plistXml.match(new RegExp(`<key>${name}</key>\\s*<data>([\\s\\S]*?)</data>`));
    if (!match) continue;
    try {
      const parsed = JSON.parse(Buffer.from(match[1].replace(/\s+/g, ""), "base64").toString("utf8"));
      const shortcut = Array.isArray(parsed) ? parsed[0] : parsed;
      const hotkey = shortcut ? fluidVoiceShortcutToHotkey(shortcut) : null;
      if (hotkey) return hotkey;
    } catch {
      continue;
    }
  }
  return null;
}

export function readFluidVoiceHotkey(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("defaults", ["export", FLUIDVOICE_DEFAULTS_DOMAIN, "-"], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : hotkeyFromFluidVoicePreferences(stdout));
    });
  });
}
