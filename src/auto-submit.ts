#!/usr/bin/env node

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(packageRoot, "scripts", "auto-submit.py");
const requirementsPath = join(packageRoot, "requirements.txt");
const python = process.env.TALKTOCURSOR_PYTHON || "python3";

if (process.platform !== "darwin") {
  console.error("talktocursor-auto-submit is supported only on macOS.");
  process.exit(1);
}

if (!existsSync(scriptPath)) {
  console.error(`Auto-submit script was not found at ${scriptPath}. Reinstall talktocursor.`);
  process.exit(1);
}

const result = spawnSync(python, [scriptPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    TALKTOCURSOR_PACKAGE_ROOT: packageRoot,
  },
});

if (result.error) {
  const detail =
    (result.error as NodeJS.ErrnoException).code === "ENOENT"
      ? `Python executable '${python}' was not found. Install Python 3 or set TALKTOCURSOR_PYTHON.`
      : result.error.message;
  console.error(`Could not start TalkToCursor auto-submit: ${detail}`);
  console.error(`Install Python dependencies with: ${python} -m pip install -r "${requirementsPath}"`);
  process.exit(1);
}

process.exit(result.status ?? 1);
