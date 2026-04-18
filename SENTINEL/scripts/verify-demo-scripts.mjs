#!/usr/bin/env node
/**
 * Static checks for demo helper scripts (#93, #94): shell syntax + required address keys.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const sh of ["scripts/seed-demo-state.sh", "scripts/pre-warm-proofs.sh"]) {
    execFileSync("bash", ["-n", join(root, sh)], { stdio: "inherit" });
}

const raw = readFileSync(join(root, "config/addresses.local.json"), "utf-8");
const addr = JSON.parse(raw);
const required = [
    "VictimLendingPool",
    "FlashLoanAttacker",
    "USDC",
    "WETH",
    "OraclePair",
    "FlashLoanProvider",
    "PolicyRegistry",
];
for (const k of required) {
    if (typeof addr[k] !== "string" || !addr[k].startsWith("0x")) {
        console.error(`config/addresses.local.json missing or invalid: ${k}`);
        process.exit(1);
    }
}

const prewarm = readFileSync(join(root, "scripts/pre-warm-proofs.sh"), "utf-8");
if (!prewarm.includes("/prove/policy") || !prewarm.includes("curl")) {
    console.error("pre-warm-proofs.sh should curl zk-prover /prove/policy");
    process.exit(1);
}

console.log("Demo scripts + addresses config look valid.");
