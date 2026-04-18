#!/usr/bin/env node
/**
 * Guardrail: every stream in absolute-docs/03 must appear in at least one publisher.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkSourceFiles(dir, acc = []) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) {
            if (name.name === "node_modules" || name.name === "dist") continue;
            walkSourceFiles(p, acc);
        } else if (/\.(ts|tsx|py|rs)$/.test(name.name)) {
            acc.push(p);
        }
    }
    return acc;
}

const doc = readFileSync(join(root, "absolute-docs/03_off_chain_services.md"), "utf-8");
const streams = [...doc.matchAll(/`?(sentinel\.[a-z0-9_.]+)`?/g)].map((m) => m[1]);
const expected = [...new Set(streams)];

const scanRoots = ["services", "packages", "frontend/src"];
const files = scanRoots.flatMap((r) => walkSourceFiles(join(root, r)));

const corpus = files.map((f) => readFileSync(f, "utf-8")).join("\n");

const missing = expected.filter((s) => !corpus.includes(s));
if (missing.length) {
    console.error("Streams from doc 03 not found in codebase:", missing.join(", "));
    process.exit(1);
}
console.log(`All ${expected.length} sentinel stream names from doc 03 are referenced in-repo.`);
