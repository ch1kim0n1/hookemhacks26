import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

export interface ProtocolProfile {
    protocolName: string;
    addressKey: string;
    trackedAddresses: Array<{
        addressKey: string;
        label: string;
        tokenKey: string;
    }>;
    attackerReplay: {
        attackerAddressKey: string;
        callerKey: string;
        method: string;
        argTypes: string[];
        args: Array<{ fromKey?: string; literalHex?: string }>;
    };
}

/**
 * Loads all protocol profiles from a directory.
 * Each .json file in the directory is a protocol profile.
 */
export function loadProfiles(profileDir: string): ProtocolProfile[] {
    const profiles: ProtocolProfile[] = [];
    let files: string[];
    try {
        files = readdirSync(profileDir).filter((f) => f.endsWith(".json"));
    } catch (err) {
        log.warn({ profileDir }, "No profiles directory found");
        return profiles;
    }
    for (const file of files) {
        try {
            const raw = readFileSync(join(profileDir, file), "utf-8");
            const profile = JSON.parse(raw) as ProtocolProfile;
            profiles.push(profile);
            log.info({ protocolName: profile.protocolName, file }, "loaded protocol profile");
        } catch (err) {
            log.error({ file, err }, "failed to load profile");
        }
    }
    return profiles;
}

/**
 * Find the profile that matches a detected threat based on the victim address.
 */
export function matchProfile(
    profiles: ProtocolProfile[],
    addresses: Record<string, string>,
    victimAddress: string,
): ProtocolProfile | undefined {
    return profiles.find((p) => {
        const addr = addresses[p.addressKey];
        return addr && addr.toLowerCase() === victimAddress.toLowerCase();
    });
}
