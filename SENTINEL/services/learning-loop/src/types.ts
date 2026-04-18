/** A Red agent attack variant — parameterized FlashLoanAttacker config */
export interface AttackVariant {
    id: string;
    /** Loan amount in wei (varies per variant) */
    loanAmountWei: string;
    /** Price manipulation factor (1.0 = no manip, 2.0 = 2x) */
    priceManipFactor: number;
    /** Flash loan provider to use */
    flashLoanProvider: string;
    /** Target protocol */
    victimProtocol: string;
    /** Generation number */
    generation: number;
    /** Parent variant ID (if mutated from another) */
    parentId?: string;
}

/** A Blue agent policy proposal */
export interface PolicyProposal {
    id: string;
    /** The updated policy JSON (serialized) */
    policyJson: string;
    /** What changed from current policy */
    changes: PolicyChange[];
    /** Generation this proposal is for */
    generation: number;
}

export interface PolicyChange {
    path: string; // JSON path to the changed field
    oldValue: unknown;
    newValue: unknown;
    reason: string;
}

/** Result of evaluating one variant against a policy */
export interface EvalResult {
    variantId: string;
    defended: boolean; // true = Blue wins (attack blocked)
    detectionTimeMs: number;
    defenseTimeMs: number;
    deltaWei: string; // financial impact if attack succeeded
    /** NN predicted probability the variant is an attack (0-1). */
    nnConfidence?: number;
    /** Whether the physics-grounded simulation labels this as a real attack. */
    groundTruthAttack?: boolean;
    /** Whether the NN alone flagged the variant (above its confidence threshold). */
    nnDetected?: boolean;
    /** Whether the declarative threshold rules flagged the variant. */
    thresholdDetected?: boolean;
}

/** Summary of a full evaluation round */
export interface EvalSummary {
    generation: number;
    totalVariants: number;
    defended: number;
    breached: number;
    winRate: number; // defended / totalVariants
    avgDetectionMs: number;
    avgDefenseMs: number;
    meetsThreshold: boolean; // winRate >= WIN_RATE_THRESHOLD
    /** NN recall on true attacks in this generation. */
    nnRecall?: number;
    /** NN precision on its positive predictions. */
    nnPrecision?: number;
    /** Share of benign variants incorrectly flagged. */
    nnFalsePositiveRate?: number;
    /** Share of variants that were genuine attacks by physics ground truth. */
    trueAttackRate?: number;
}

/** Training telemetry event published via Streams */
export interface TrainingEvent {
    schema: "TrainingEvent@1";
    type:
        | "generation_start"
        | "variant_result"
        | "generation_complete"
        | "policy_update"
        | "nn_training_start"
        | "nn_training_epoch"
        | "nn_training_complete";
    generation: number;
    timestamp: string;
    data: Record<string, unknown>;
}

/** Configuration for the training loop */
export interface TrainingConfig {
    /** Number of variants per generation */
    populationSize: number;
    /** Win rate needed to commit policy update */
    winRateThreshold: number;
    /** Max generations before stopping */
    maxGenerations: number;
    /** Delay between generations (ms) */
    generationDelayMs: number;
    /** RPC URL for Anvil */
    rpcUrl: string;
    /** Redis URL */
    redisUrl: string;
    /** Path to policy.json */
    policyPath: string;
    /** Path to addresses.local.json */
    addressesPath: string;
    /** PolicyRegistry contract address (optional — skips on-chain update if absent) */
    policyRegistryAddress?: string;
    /** Operator private key for submitting on-chain updates (optional) */
    operatorKey?: string;
    /** Neural net training epochs per generation (default 3). */
    nnEpochsPerGeneration?: number;
    /** Neural net minibatch size (default 8). */
    nnBatchSize?: number;
}
