/** Load shared JSON Schema copies (logical + physical 0.1.0-draft). */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED = join(__dirname, "schema_data");
const MONOREPO = join(__dirname, "..", "..", "schemas");

export function schemasDir(): string {
  if (existsSync(join(MONOREPO, "logical-plan.schema.json"))) return MONOREPO;
  return BUNDLED;
}

export function loadSchema(name: string): Record<string, unknown> {
  const stem = name.replace(/\.schema\.json$/, "").replace(/\.json$/, "");
  let path = join(schemasDir(), `${stem}.schema.json`);
  if (!existsSync(path)) path = join(BUNDLED, `${stem}.schema.json`);
  if (!existsSync(path)) throw new Error(`schema not found: ${name}`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function logicalPlanSchema(): Record<string, unknown> {
  return loadSchema("logical-plan");
}

export function physicalPlanSchema(): Record<string, unknown> {
  return loadSchema("physical-plan");
}
