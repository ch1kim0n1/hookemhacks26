import { http, createPublicClient, parseAbi } from "viem";

const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface TrackedAddress {
    address: `0x${string}`;
    label: string;
    token: `0x${string}`;
}

export interface Balance {
    address: `0x${string}`;
    label: string;
    balanceWei: bigint;
}

export async function queryBalances(rpcUrl: string, tracked: TrackedAddress[]): Promise<Balance[]> {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const out: Balance[] = [];
    for (const t of tracked) {
        const bal = (await client.readContract({
            address: t.token,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [t.address],
        })) as bigint;
        out.push({ address: t.address, label: t.label, balanceWei: bal });
    }
    return out;
}

export interface DeltaLeaf {
    address: `0x${string}`;
    label: string;
    realWei: string; // JSON-safe (bigint → string)
    shadowWei: string;
    deltaWei: string; // shadow - real
}

export function diff(
    real: Balance[],
    shadow: Balance[],
): {
    leaves: DeltaLeaf[];
    totalDeltaWei: bigint;
} {
    const byLabel = new Map(real.map((b) => [b.label, b]));
    const leaves: DeltaLeaf[] = [];
    let total = 0n;
    for (const s of shadow) {
        const r = byLabel.get(s.label);
        if (!r) continue;
        const delta = s.balanceWei - r.balanceWei;
        leaves.push({
            address: s.address,
            label: s.label,
            realWei: r.balanceWei.toString(),
            shadowWei: s.balanceWei.toString(),
            deltaWei: delta.toString(),
        });
        // "Prevented loss" = drop in victim-labelled reserves in the
        // shadow timeline. Positive total = SENTINEL saved that much.
        if (s.label.startsWith("victim.")) {
            total += r.balanceWei - s.balanceWei;
        }
    }
    return { leaves, totalDeltaWei: total };
}
