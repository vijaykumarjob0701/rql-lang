#!/usr/bin/env node
/**
 * Best-effort one-command demo: docker compose Qdrant if possible, then seed.
 * Falls back to printing mock-qdrant instructions when Docker is unavailable.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: web, ...opts });
}

const compose = run("docker", ["compose", "-f", "docker-compose.yml", "up", "-d"]);
if (compose.status !== 0) {
  console.log("");
  console.log("Docker compose did not start Qdrant. Fallback:");
  console.log("  npm run mock-qdrant   # terminal 1");
  console.log("  npm run seed          # terminal 2");
  console.log("  npm run dev");
  process.exit(compose.status ?? 1);
}

for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch("http://127.0.0.1:6333/readyz");
    if (res.ok) break;
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const seed = run("node", ["scripts/seed.mjs"]);
if (seed.status !== 0) process.exit(seed.status ?? 1);
console.log("");
console.log("Next: npm run dev  →  http://127.0.0.1:5173");
