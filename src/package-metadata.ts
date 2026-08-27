import { createRequire } from "module";

interface PackageMetadata {
  name: string;
  version: string;
}

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as PackageMetadata;

export const PACKAGE_NAME = packageJson.name;
export const PACKAGE_VERSION = packageJson.version;
