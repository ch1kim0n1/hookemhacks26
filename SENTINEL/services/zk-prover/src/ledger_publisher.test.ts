import { describe, expect, it } from "vitest";
import { type CounterfactualReadyEvent, buildGuestInputs } from "./ledger_publisher.js";

describe("buildGuestInputs", () => {
    const EVENT: CounterfactualReadyEvent = {
        eventId: ("0x" + "ab".repeat(32)) as `0x${string}`,
        deltaWei: "400",
        counterfactualRoot: ("0x" + "cd".repeat(32)) as `0x${string}`,
        victimProtocol: ("0x" + "11".repeat(20)) as `0x${string}`,
        forkBlock: 42,
        leaves: [
            {
                address: ("0x" + "11".repeat(20)) as `0x${string}`,
                label: "victim.wethReserve",
                realWei: "1000",
                shadowWei: "600",
                deltaWei: "-400",
            },
            {
                // Non-victim leaf: ignored by the guest.
                address: ("0x" + "22".repeat(20)) as `0x${string}`,
                label: "attacker.wethBalance",
                realWei: "0",
                shadowWei: "500",
                deltaWei: "500",
            },
        ],
    };

    it("passes only victim-prefixed leaves to the guest", () => {
        const inputs = buildGuestInputs(EVENT);
        expect(inputs.deltas).toHaveLength(1);
    });

    it("encodes the claimed delta (positive prevented-loss) as big-endian bytes32", () => {
        const inputs = buildGuestInputs(EVENT);
        // 400 = 0x00...0190
        const hex = inputs.claimed_delta_wei_be.map((n) => n.toString(16).padStart(2, "0")).join("");
        expect(hex).toBe("0".repeat(61) + "190");
    });

    it("encodes a per-leaf prevented loss (real - shadow) as big-endian int256", () => {
        const inputs = buildGuestInputs(EVENT);
        // real=1000, shadow=600 → prevented = 400 = 0x190
        const hex = inputs.deltas[0].delta_wei_be.map((n) => n.toString(16).padStart(2, "0")).join("");
        expect(hex).toBe("0".repeat(61) + "190");
    });

    it("packs eventId and victim as raw bytes of the correct length", () => {
        const inputs = buildGuestInputs(EVENT);
        expect(inputs.event_id).toHaveLength(32);
        expect(inputs.victim_protocol).toHaveLength(20);
    });

    it("handles a zero prevented-loss (no-op defense)", () => {
        const e: CounterfactualReadyEvent = {
            ...EVENT,
            deltaWei: "0",
            leaves: [
                {
                    address: EVENT.victimProtocol,
                    label: "victim.wethReserve",
                    realWei: "1000",
                    shadowWei: "1000",
                    deltaWei: "0",
                },
            ],
        };
        const inputs = buildGuestInputs(e);
        expect(inputs.claimed_delta_wei_be.every((b) => b === 0)).toBe(true);
    });
});
