import { encodePacked, keccak256 } from "viem";
import type { DeltaLeaf } from "./delta.js";

/** keccak256 pair-hash (sorted) Merkle root over (address,label,deltaWei). */
export function computeRoot(leaves: DeltaLeaf[]): `0x${string}` {
    if (leaves.length === 0) {
        return ("0x" + "00".repeat(32)) as `0x${string}`;
    }
    let layer: `0x${string}`[] = leaves.map((l) =>
        keccak256(encodePacked(["address", "string", "int256"], [l.address, l.label, BigInt(l.deltaWei)])),
    );
    while (layer.length > 1) {
        const next: `0x${string}`[] = [];
        for (let i = 0; i < layer.length; i += 2) {
            const a = layer[i];
            const b = i + 1 < layer.length ? layer[i + 1] : layer[i];
            const [lo, hi] = a < b ? [a, b] : [b, a];
            next.push(keccak256(encodePacked(["bytes32", "bytes32"], [lo, hi])));
        }
        layer = next;
    }
    return layer[0];
}
