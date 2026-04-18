import { describe, expect, it } from "vitest";
import { type ProtocolProfile, loadProfiles, matchProfile } from "./protocol-adapter.js";

const PROFILES: ProtocolProfile[] = [
    {
        protocolName: "LendingPool",
        addressKey: "VictimLendingPool",
        trackedAddresses: [],
        attackerReplay: { attackerAddressKey: "", callerKey: "", method: "", argTypes: [], args: [] },
    },
    {
        protocolName: "DemoAMM",
        addressKey: "DemoAMM",
        trackedAddresses: [],
        attackerReplay: { attackerAddressKey: "", callerKey: "", method: "", argTypes: [], args: [] },
    },
];

const ADDRESSES = {
    VictimLendingPool: "0xAbCd1234",
    DemoAMM: "0xEfGh5678",
};

describe("protocol-adapter", () => {
    it("matchProfile finds the correct profile by victim address", () => {
        const result = matchProfile(PROFILES, ADDRESSES, "0xabcd1234");
        expect(result?.protocolName).toBe("LendingPool");
    });

    it("matchProfile returns undefined for unknown address", () => {
        const result = matchProfile(PROFILES, ADDRESSES, "0x9999");
        expect(result).toBeUndefined();
    });

    it("matchProfile is case-insensitive", () => {
        const result = matchProfile(PROFILES, ADDRESSES, "0xABCD1234");
        expect(result?.protocolName).toBe("LendingPool");
    });

    it("loadProfiles loads from the config directory", () => {
        const profiles = loadProfiles("../../config/protocol-profiles");
        expect(profiles.length).toBeGreaterThanOrEqual(1);
        expect(profiles.some((p) => p.protocolName === "VictimLendingPool")).toBe(true);
    });
});
