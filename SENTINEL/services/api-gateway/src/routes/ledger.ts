import type { FastifyInstance } from "fastify";
import { http, createPublicClient, parseAbi } from "viem";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

// Entry struct matches CounterfactualLedger.sol.
const LEDGER_ABI = parseAbi([
    "function getEntryCount() view returns (uint256)",
    "function getEntryAt(uint256 index) view returns ((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt))",
    "function getEntry(bytes32 eventId) view returns ((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt))",
]);

export async function registerLedgerRoutes(
    app: FastifyInstance,
    addresses: Record<string, string>,
    counterfactualTrees: Map<string, unknown>,
): Promise<void> {
    app.get("/api/v1/ledger", async () => {
        try {
            const client = createPublicClient({ transport: http(RPC_URL) });
            const addr = addresses.CounterfactualLedger as `0x${string}`;
            const count = await client.readContract({
                address: addr,
                abi: LEDGER_ABI,
                functionName: "getEntryCount",
            });
            const total = Number(count);
            const entries: unknown[] = [];
            let totalDelta = 0n;
            for (let i = 0; i < total; i++) {
                const e = (await client.readContract({
                    address: addr,
                    abi: LEDGER_ABI,
                    functionName: "getEntryAt",
                    args: [BigInt(i)],
                })) as {
                    eventId: `0x${string}`;
                    atBlock: bigint;
                    deltaWei: bigint;
                    realTxHash: `0x${string}`;
                    counterfactualRoot: `0x${string}`;
                    proofDigest: `0x${string}`;
                    recordedAt: bigint;
                };
                entries.push({
                    eventId: e.eventId,
                    atBlock: Number(e.atBlock),
                    deltaWei: e.deltaWei.toString(),
                    realTxHash: e.realTxHash,
                    counterfactualRoot: e.counterfactualRoot,
                    proofDigest: e.proofDigest,
                    recordedAt: Number(e.recordedAt),
                });
                totalDelta += e.deltaWei;
            }
            return {
                entries: entries.reverse(),
                totalDeltaWei: totalDelta.toString(),
                totalEntryCount: total,
            };
        } catch {
            return { entries: [], totalDeltaWei: "0", totalEntryCount: 0 };
        }
    });

    app.get<{ Params: { eventId: string } }>("/api/v1/ledger/:eventId/counterfactual-tree", async (req, reply) => {
        const tree = counterfactualTrees.get(req.params.eventId);
        if (!tree) {
            reply.code(404);
            return {
                error: {
                    code: "NOT_FOUND",
                    message: "no tree cached for this event",
                },
            };
        }
        return tree;
    });
}
