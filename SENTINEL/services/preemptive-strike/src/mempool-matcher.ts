import { keccak256, toHex } from "viem";
import { log } from "./logger.js";

export interface MatchResult {
    txHash: string;
    signatureHash: string;
    /** Protocol to protect — may differ from tx.to when attacker pattern is used. */
    target: string;
    matched: boolean;
}

interface AttackerPattern {
    /** 4-byte selector, lowercase hex with 0x prefix. */
    selector: string;
    /** Protocol address to protect when this attacker+selector fires. */
    targetProtocol: string;
    signatureHash: string;
}

export class MempoolMatcher {
    /** Legacy: pattern string → keccak hash (matches on tx.to === targetProtocol). */
    private knownSignatures = new Map<string, string>();

    /** Pre-emptive: attacker address (lowercase) → pattern config. */
    private attackerPatterns = new Map<string, AttackerPattern>();

    /**
     * Register an attacker-address + selector pair for pre-emptive matching.
     * When a mempool tx goes to `attackerAddress` with `attackSelector`,
     * the engine pre-emptively pauses `targetProtocol` before the attack lands.
     */
    addAttackerPattern(attackerAddress: string, attackSelector: string, targetProtocol: string): string {
        const sigInput = `${attackerAddress.toLowerCase()}:${attackSelector.toLowerCase()}`;
        const hash = keccak256(toHex(sigInput));
        this.attackerPatterns.set(attackerAddress.toLowerCase(), {
            selector: attackSelector.toLowerCase(),
            targetProtocol,
            signatureHash: hash,
        });
        log.debug({ attackerAddress, attackSelector, targetProtocol }, "registered attacker pattern");
        return hash;
    }

    /** Legacy: register a pattern matched on victim protocol address. */
    addPattern(pattern: string, targetProtocol: string): string {
        const sigInput = `${pattern}:${targetProtocol}`;
        const hash = keccak256(toHex(sigInput));
        this.knownSignatures.set(hash, `${pattern}:${targetProtocol}`);
        return hash;
    }

    /** Check if a pending transaction matches any known threat signature. */
    matchTransaction(tx: {
        to: string;
        data: string;
        hash: string;
    }): MatchResult | null {
        const toAddr = tx.to.toLowerCase();

        // Pre-emptive: check attacker address + 4-byte selector.
        const attackerPat = this.attackerPatterns.get(toAddr);
        if (attackerPat) {
            const txSelector = tx.data.slice(0, 10).toLowerCase();
            if (txSelector === attackerPat.selector) {
                log.info(
                    { txHash: tx.hash, attackerAddr: toAddr, selector: txSelector, target: attackerPat.targetProtocol },
                    "preemptive threat match — attacker selector detected",
                );
                return {
                    txHash: tx.hash,
                    signatureHash: attackerPat.signatureHash,
                    target: attackerPat.targetProtocol,
                    matched: true,
                };
            }
        }

        // Legacy: match on victim protocol address.
        for (const [sigHash, pattern] of this.knownSignatures) {
            const [patternName, targetProtocol] = pattern.split(":");
            if (toAddr === targetProtocol.toLowerCase()) {
                log.info(
                    { txHash: tx.hash, signatureHash: sigHash, pattern: patternName },
                    "threat match found (legacy protocol match)",
                );
                return {
                    txHash: tx.hash,
                    signatureHash: sigHash,
                    target: tx.to,
                    matched: true,
                };
            }
        }

        return null;
    }

    get patternCount(): number {
        return this.knownSignatures.size + this.attackerPatterns.size;
    }
}
