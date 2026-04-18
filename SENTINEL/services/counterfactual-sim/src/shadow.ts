import { http, createPublicClient, encodeFunctionData, parseAbi } from "viem";
import { log as rootLog } from "./logger.js";

const slog = rootLog.child({ module: "shadow" });

/**
 * Replay the canonical attacker transaction on the fork. Uses
 * anvil_impersonateAccount so no signature from the caller is needed —
 * the fork treats it as if the attacker signed.
 *
 * Returns the fork-local tx hash. On revert, throws (which would mean
 * the fork state drifted from main; caller should retry or abort).
 */
export async function replayAttack(params: {
    forkRpc: string;
    callerAddress: `0x${string}`;
    attackerContract: `0x${string}`;
    method: string; // e.g. "attack(address,uint256)"
    args: unknown[];
}): Promise<`0x${string}`> {
    const pub = createPublicClient({ transport: http(params.forkRpc) });

    // Impersonate the attacker's owner key.
    await fetch(params.forkRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "anvil_impersonateAccount",
            params: [params.callerAddress],
        }),
    });

    // Top up the impersonated account so it can pay gas on the fork.
    await fetch(params.forkRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "anvil_setBalance",
            params: [params.callerAddress, "0x56BC75E2D63100000"], // 100 ETH
        }),
    });

    const funcName = params.method.slice(0, params.method.indexOf("("));
    // parseAbi's template types get picky with dynamic strings; cast via unknown.
    const abi = parseAbi([
        `function ${params.method}` as `function ${string}`,
    ] as unknown as readonly string[]) as unknown as Parameters<typeof encodeFunctionData>[0]["abi"];
    const data = encodeFunctionData({
        abi,
        functionName: funcName,
        args: params.args as readonly unknown[],
    } as Parameters<typeof encodeFunctionData>[0]);

    slog.info(
        {
            forkRpc: params.forkRpc,
            caller: params.callerAddress,
            target: params.attackerContract,
            method: params.method,
            calldata: data,
        },
        "shadow.replay.prepare",
    );
    // Send via eth_sendTransaction with the impersonated `from`.
    const sendResp = await fetch(params.forkRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "eth_sendTransaction",
            params: [
                {
                    from: params.callerAddress,
                    to: params.attackerContract,
                    data,
                    gas: "0x2DC6C0", // 3M
                },
            ],
        }),
    });
    const sent = (await sendResp.json()) as {
        result?: string;
        error?: { message: string };
    };
    if (!sent.result) throw new Error(`shadow replay send failed: ${sent.error?.message}`);
    const txHash = sent.result as `0x${string}`;

    // Wait for it to be mined on the fork.
    const receipt = await pub.waitForTransactionReceipt({
        hash: txHash,
        timeout: 15_000,
    });
    if (receipt.status !== "success") {
        // Attempt to get a revert reason via debug_traceTransaction.
        let reason = "unknown";
        try {
            const trace = await fetch(params.forkRpc, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 99,
                    method: "debug_traceTransaction",
                    params: [txHash, { tracer: "callTracer" }],
                }),
            });
            const traceJson = (await trace.json()) as {
                result?: { error?: string; revertReason?: string };
            };
            reason = traceJson.result?.revertReason ?? traceJson.result?.error ?? "no reason";
        } catch {
            /* ignore */
        }
        throw new Error(
            `shadow replay reverted (${reason}): tx=${txHash} gas=${receipt.gasUsed} data=${data.slice(0, 10)}...`,
        );
    }
    return txHash;
}
