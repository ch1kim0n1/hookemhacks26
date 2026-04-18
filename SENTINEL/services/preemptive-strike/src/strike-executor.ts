import type { StreamPublisher } from "@sentinel/stream-client";
import { http, type Hex, createPublicClient, createWalletClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { log } from "./logger.js";
import type { PreemptiveAction } from "./types.js";

const PAUSE_CONTROLLER_ABI = parseAbi(["function activate(address target, uint8 defenseType, bytes32 eventId)"]);

export class StrikeExecutor {
    private rpcUrl: string;
    private pauseControllerAddress: Hex;
    private operatorKey: Hex;
    private streamPub: StreamPublisher;
    private executedActions: PreemptiveAction[] = [];

    constructor(rpcUrl: string, pauseControllerAddress: Hex, operatorKey: Hex, streamPub: StreamPublisher) {
        this.rpcUrl = rpcUrl;
        this.pauseControllerAddress = pauseControllerAddress;
        this.operatorKey = operatorKey;
        this.streamPub = streamPub;
    }

    /**
     * Execute a pre-emptive pause on the target protocol.
     */
    async executePreemptivePause(
        targetProtocol: Hex,
        signatureHash: string,
        matchingTxHash: string,
    ): Promise<PreemptiveAction> {
        const account = privateKeyToAccount(this.operatorKey as Hex);
        const pub = createPublicClient({ transport: http(this.rpcUrl) });
        const wallet = createWalletClient({ account, transport: http(this.rpcUrl) });

        const eventId = signatureHash as Hex; // Use signature hash as event ID

        try {
            const hash = await wallet.writeContract({
                address: this.pauseControllerAddress,
                abi: PAUSE_CONTROLLER_ABI,
                functionName: "activate",
                args: [targetProtocol, 1, eventId], // 1 = Pause
                chain: null,
            });
            await pub.waitForTransactionReceipt({ hash });

            const action: PreemptiveAction = {
                targetProtocol,
                signatureHash,
                matchingTxHash,
                action: "pause",
                defenseTxHash: hash,
            };

            await this.streamPub.publish("sentinel.preemptive.executed", {
                schema: "PreemptiveStrikeEvent@1",
                ...action,
                timestamp: new Date().toISOString(),
            });

            this.executedActions.push(action);
            log.info({ targetProtocol, signatureHash, txHash: hash }, "pre-emptive pause executed");
            return action;
        } catch (err: any) {
            log.error({ err: err.message, targetProtocol, signatureHash }, "pre-emptive pause failed");

            // Publish alert even on failure
            const action: PreemptiveAction = {
                targetProtocol,
                signatureHash,
                matchingTxHash,
                action: "alert",
            };
            await this.streamPub.publish("sentinel.preemptive.alert", {
                schema: "PreemptiveAlertEvent@1",
                ...action,
                error: err.message,
                timestamp: new Date().toISOString(),
            });
            return action;
        }
    }

    get actions(): PreemptiveAction[] {
        return this.executedActions;
    }
}
