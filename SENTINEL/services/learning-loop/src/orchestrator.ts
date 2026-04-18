import { StreamPublisher } from "@sentinel/stream-client";
import { Redis } from "ioredis";
import { BlueAgent } from "./blue-agent.js";
import { ChainUpdater } from "./chain-updater.js";
import { EvalHarness, type PolicySnapshot } from "./eval-harness.js";
import { log } from "./logger.js";
import { NeuralDetector } from "./neural-detector.js";
import { generateLearningProof } from "./proof-generator.js";
import { RedAgent } from "./red-agent.js";
import type { AttackVariant, TrainingConfig, TrainingEvent } from "./types.js";

const DEFAULT_BASE_LOAN_WEI = "900000000000000000000"; // 900 ETH

export class TrainingOrchestrator {
    private redAgent: RedAgent;
    private blueAgent: BlueAgent;
    private evalHarness: EvalHarness;
    private detector: NeuralDetector;
    private streamPub: StreamPublisher;
    private config: TrainingConfig;
    private chainUpdater: ChainUpdater | null = null;
    private running = false;

    constructor(config: TrainingConfig) {
        this.config = config;

        this.redAgent = new RedAgent({
            baseLoanWei: DEFAULT_BASE_LOAN_WEI,
            priceManipRange: [1.5, 5.0],
            flashLoanProvider: "",
            victimProtocol: "",
        });

        this.blueAgent = new BlueAgent({ policyPath: config.policyPath });
        this.detector = new NeuralDetector({ baseLoanWei: BigInt(DEFAULT_BASE_LOAN_WEI) });

        const policySnapshot = this.blueAgent.policy as PolicySnapshot;
        this.evalHarness = new EvalHarness(policySnapshot, this.detector);

        const redis = new Redis(config.redisUrl);
        this.streamPub = new StreamPublisher(redis);

        if (config.policyRegistryAddress && config.operatorKey) {
            this.chainUpdater = new ChainUpdater({
                rpcUrl: config.rpcUrl,
                policyRegistryAddress: config.policyRegistryAddress as `0x${string}`,
                operatorKey: config.operatorKey as `0x${string}`,
            });
        }
    }

    setAddresses(addresses: Record<string, string>): void {
        this.redAgent = new RedAgent({
            baseLoanWei: DEFAULT_BASE_LOAN_WEI,
            priceManipRange: [1.5, 5.0],
            flashLoanProvider: addresses.FlashLoanProvider ?? "",
            victimProtocol: addresses.VictimLendingPool ?? "",
        });
    }

    /**
     * Training loop.
     *
     * Each generation:
     *   1. Red generates variants (Bayesian + survivor mutation after gen 1).
     *   2. EvalHarness records ground-truth attack labels (physics) and runs
     *      both the NN and threshold policy; outcomes published per variant.
     *   3. Blue trains the neural net on the accumulated buffer (per-epoch
     *      loss/accuracy published as telemetry).
     *   4. If win rate < threshold, Blue proposes a threshold-rule tightening
     *      derived from the current breaches (safety floor while NN learns).
     *   5. Survivors (breached variants) feed Red's next generation.
     *
     * When win rate meets the configured threshold, the proof is generated and
     * policy committed on-chain (if a registry + operator key are configured).
     */
    async run(): Promise<void> {
        this.running = true;
        let survivors: AttackVariant[] | undefined;
        const generationHistory: Array<{ attackCount: number; defendedCount: number }> = [];

        for (let gen = 1; gen <= this.config.maxGenerations && this.running; gen++) {
            log.info({ generation: gen }, "generation start");

            await this.publishEvent({
                schema: "TrainingEvent@1",
                type: "generation_start",
                generation: gen,
                timestamp: new Date().toISOString(),
                data: { populationSize: this.config.populationSize },
            });

            const variants = this.redAgent.generatePopulation(this.config.populationSize, survivors);

            const { results, summary } = this.evalHarness.evaluatePopulation(variants, gen);
            this.redAgent.observeResults(variants, results);
            summary.meetsThreshold = summary.winRate >= this.config.winRateThreshold;

            for (const result of results) {
                await this.publishEvent({
                    schema: "TrainingEvent@1",
                    type: "variant_result",
                    generation: gen,
                    timestamp: new Date().toISOString(),
                    data: {
                        variantId: result.variantId,
                        defended: result.defended,
                        deltaWei: result.deltaWei,
                        detectionTimeMs: result.detectionTimeMs,
                        nnConfidence: result.nnConfidence,
                        nnDetected: result.nnDetected,
                        thresholdDetected: result.thresholdDetected,
                        groundTruthAttack: result.groundTruthAttack,
                    },
                });
            }

            generationHistory.push({ attackCount: summary.totalVariants, defendedCount: summary.defended });

            await this.publishEvent({
                schema: "TrainingEvent@1",
                type: "generation_complete",
                generation: gen,
                timestamp: new Date().toISOString(),
                data: { ...summary },
            });

            log.info(
                {
                    generation: gen,
                    winRate: summary.winRate,
                    nnRecall: summary.nnRecall,
                    nnPrecision: summary.nnPrecision,
                },
                "generation complete",
            );

            // --- Train the neural network on the accumulated buffer. ---
            await this.trainNeuralNet(gen);

            if (!summary.meetsThreshold && summary.breached > 0) {
                const proposal = this.blueAgent.proposeUpdate(gen, variants, results);
                if (proposal) {
                    this.blueAgent.acceptProposal(proposal);
                    this.evalHarness.updatePolicy(this.blueAgent.policy as PolicySnapshot);

                    await this.publishEvent({
                        schema: "TrainingEvent@1",
                        type: "policy_update",
                        generation: gen,
                        timestamp: new Date().toISOString(),
                        data: {
                            proposalId: proposal.id,
                            changes: proposal.changes,
                            newWinRate: summary.winRate,
                        },
                    });

                    log.info({ generation: gen, changes: proposal.changes.length }, "policy updated");
                }
            }

            survivors = results
                .filter((r) => !r.defended)
                .map((r) => variants.find((v) => v.id === r.variantId)!)
                .filter(Boolean);

            if (summary.meetsThreshold) {
                log.info({ generation: gen, finalWinRate: summary.winRate }, "win rate threshold met");

                if (this.chainUpdater) {
                    try {
                        const currentHash = await this.chainUpdater.getCurrentPolicyHash();
                        const proof = await generateLearningProof({
                            oldPolicyHash: currentHash,
                            newPolicyJson: JSON.stringify(this.blueAgent.policy),
                            generationCount: gen,
                            winRate: summary.winRate,
                            generations: [...generationHistory],
                        });
                        const result = await this.chainUpdater.submitPolicyUpdate(proof);
                        log.info({ txHash: result.txHash, newHash: result.newHash }, "policy committed on-chain");

                        await this.publishEvent({
                            schema: "TrainingEvent@1",
                            type: "policy_update",
                            generation: gen,
                            timestamp: new Date().toISOString(),
                            data: {
                                txHash: result.txHash,
                                blockNumber: Number(result.blockNumber),
                                oldHash: result.oldHash,
                                newHash: result.newHash,
                                winRate: summary.winRate,
                                onChain: true,
                            },
                        });
                    } catch (err) {
                        log.error({ err, generation: gen }, "on-chain policy update failed");
                    }
                }

                break;
            }

            if (gen < this.config.maxGenerations) {
                await new Promise((r) => setTimeout(r, this.config.generationDelayMs));
            }
        }

        this.running = false;
    }

    async stop(): Promise<void> {
        this.running = false;
    }

    get isRunning(): boolean {
        return this.running;
    }

    /** Expose the detector for tests + inspection (weights, buffer, metrics). */
    get neuralDetector(): NeuralDetector {
        return this.detector;
    }

    private async trainNeuralNet(generation: number): Promise<void> {
        const epochs = this.config.nnEpochsPerGeneration ?? 3;
        const batchSize = this.config.nnBatchSize ?? 8;

        await this.publishEvent({
            schema: "TrainingEvent@1",
            type: "nn_training_start",
            generation,
            timestamp: new Date().toISOString(),
            data: {
                bufferSize: this.detector.bufferSize,
                positiveRate: Math.round(this.detector.positiveRate * 10000) / 10000,
                epochs,
                batchSize,
            },
        });

        const metrics = this.detector.train({ epochs, batchSize });

        for (const m of metrics) {
            await this.publishEvent({
                schema: "TrainingEvent@1",
                type: "nn_training_epoch",
                generation,
                timestamp: new Date().toISOString(),
                data: {
                    epoch: m.epoch,
                    loss: m.loss,
                    accuracy: m.accuracy,
                    examples: m.examples,
                },
            });
        }

        if (metrics.length > 0) {
            const final = metrics[metrics.length - 1];
            await this.publishEvent({
                schema: "TrainingEvent@1",
                type: "nn_training_complete",
                generation,
                timestamp: new Date().toISOString(),
                data: {
                    finalLoss: final.loss,
                    finalAccuracy: final.accuracy,
                    examples: final.examples,
                    epochs: metrics.length,
                },
            });

            log.info(
                {
                    generation,
                    finalLoss: final.loss,
                    finalAccuracy: final.accuracy,
                    examples: final.examples,
                },
                "neural net training complete",
            );
        }
    }

    private async publishEvent(event: TrainingEvent): Promise<void> {
        await this.streamPub.publish("sentinel.training.telemetry", event as unknown as Record<string, unknown>);
    }
}
