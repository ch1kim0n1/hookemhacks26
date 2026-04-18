#!/usr/bin/env node
/**
 * Ensures demo timing config stays duplicated correctly for Vite static fetch
 * (`frontend/public/config/timings.json`) vs repo root (`config/timings.json`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const a = JSON.parse(readFileSync(join(root, "config/timings.json"), "utf-8"));
const b = JSON.parse(readFileSync(join(root, "frontend/public/config/timings.json"), "utf-8"));

if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("config/timings.json and frontend/public/config/timings.json differ. Keep them in sync.");
    process.exit(1);
}
console.log("timings.json files are in sync.");
