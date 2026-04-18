#!/usr/bin/env node
// Verify that config/addresses.local.json is present, complete, and live against RPC.
//
// Exits 0 if every required contract has deployed bytecode on the target chain.
// Exits 1 if the file is missing, any required key is absent, or any address is
// an EOA (no code) — which means the file is stale relative to the chain.
//
// Usage:
//   node scripts/verify-addresses.mjs                # uses defaults
//   RPC_URL=http://anvil:8545 node scripts/verify-addresses.mjs
//   ADDRESSES_FILE=/config/addresses.local.json node scripts/verify-addresses.mjs
//
// Used by: bootstrap.sh, demo-preflight.sh, CI, and each service at startup.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_KEYS = [
    "CounterfactualLedger",
    "CounterfactualVerifier",
    "FlashLoanAttacker",
    "FlashLoanProvider",
    "LearningVerifier",
    "OraclePair",
    "PauseController",
    "PolicyRegistry",
    "PolicyVerifier",
    "QuarantineVault",
    "SentinelGuard",
    "ThreatRegistry",
    "USDC",
    "VictimLendingPool",
    "WETH",
];

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function die(msg, code = 1) {
    console.error(`\x1b[31m[verify-addresses] ${msg}\x1b[0m`);
    process.exit(code);
}

function info(msg) {
    console.log(`[verify-addresses] ${msg}`);
}

async function rpcCall(rpcUrl, method, params) {
    const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) throw new Error(`RPC ${method} returned HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(`RPC ${method} error: ${j.error.message}`);
    return j.result;
}

async function main() {
    const file = process.env.ADDRESSES_FILE ?? resolve(process.cwd(), "config/addresses.local.json");
    const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const skipRpc = process.env.SKIP_RPC_CHECK === "1";

    let raw;
    try {
        raw = readFileSync(file, "utf-8");
    } catch (e) {
        die(
            `cannot read ${file}: ${e.message}\n  -> run: forge script contracts/script/DeployLocal.s.sol --rpc-url ${rpcUrl} --broadcast`,
        );
    }

    let addresses;
    try {
        addresses = JSON.parse(raw);
    } catch (e) {
        die(`invalid JSON in ${file}: ${e.message}`);
    }

    const missing = REQUIRED_KEYS.filter((k) => !addresses[k]);
    if (missing.length > 0) {
        die(`missing required addresses: ${missing.join(", ")}`);
    }

    const malformed = REQUIRED_KEYS.filter((k) => !ADDR_RE.test(String(addresses[k])));
    if (malformed.length > 0) {
        die(`malformed address(es) (not 0x + 40 hex): ${malformed.join(", ")}`);
    }

    info(`file OK: ${file} (${REQUIRED_KEYS.length} required keys present)`);

    if (skipRpc) {
        info("SKIP_RPC_CHECK=1 — skipping on-chain bytecode probe");
        process.exit(0);
    }

    // Probe RPC; surface a gentler error if the chain is just down.
    let chainId;
    try {
        chainId = await rpcCall(rpcUrl, "eth_chainId", []);
    } catch (e) {
        die(
            `cannot reach RPC ${rpcUrl}: ${e.message}\n  -> ensure anvil is running (docker compose up anvil) or set RPC_URL=`,
        );
    }
    info(`RPC live at ${rpcUrl} (chainId=${Number.parseInt(chainId, 16)})`);

    const results = await Promise.all(
        REQUIRED_KEYS.map(async (k) => {
            try {
                const code = await rpcCall(rpcUrl, "eth_getCode", [addresses[k], "latest"]);
                return { key: k, addr: addresses[k], hasCode: code && code !== "0x" && code !== "0x0" };
            } catch (e) {
                return { key: k, addr: addresses[k], hasCode: false, error: e.message };
            }
        }),
    );

    const stale = results.filter((r) => !r.hasCode);
    if (stale.length > 0) {
        console.error("\x1b[31m[verify-addresses] stale addresses (no bytecode on chain):\x1b[0m");
        for (const s of stale) {
            console.error(`  - ${s.key} @ ${s.addr}${s.error ? ` (${s.error})` : ""}`);
        }
        die(
            `${stale.length} of ${REQUIRED_KEYS.length} addresses are stale — redeploy:\n  forge script contracts/script/DeployLocal.s.sol --rpc-url ${rpcUrl} --broadcast`,
        );
    }

    info(`all ${REQUIRED_KEYS.length} contracts have live bytecode — addresses fresh`);
}

main().catch((err) => die(err.stack || err.message));
