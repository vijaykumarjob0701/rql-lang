import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["profiles", "schema_data"]) {
  mkdirSync(join(root, "dist", dir), { recursive: true });
  cpSync(join(root, "src", dir), join(root, "dist", dir), { recursive: true });
}
console.log("copied profiles + schema_data → dist/");
