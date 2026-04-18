export interface EventEnvelope {
    channel: string;
    messageId: string;
    emittedAt: string;
    kind: string;
    data: unknown;
}

export interface TrustCollapseCue {
    kind: "TRUST_COLLAPSE_CUE";
    eventId: string | null;
    state: "AMBIGUITY" | "SUSPICION" | "PROOF_INJECTION" | "RESOLVED" | "REJECTED" | "AWAITING_APPROVAL";
    message: string;
    underlyingTxHash?: string | null;
    proofDigest?: string | null;
    reason?: string;
    revertReason?: string;
}

export function redisChannelToKind(ch: string): string {
    const map: Record<string, string> = {
        "sentinel.mempool.pending": "PENDING_TX",
        "sentinel.mempool.block": "BLOCK",
        "sentinel.detection.candidate": "THREAT_CANDIDATE",
        "sentinel.detection.confirmed": "THREAT_CONFIRMED",
        "sentinel.defense.submitted": "DEFENSE_SUBMITTED",
        "sentinel.defense.mined": "DEFENSE_MINED",
        "sentinel.defense.rejected": "DEFENSE_REJECTED",
        "sentinel.defense.pending_approval": "DEFENSE_PENDING_APPROVAL",
        "sentinel.defense.approval": "DEFENSE_APPROVAL",
        "sentinel.counterfactual.ready": "COUNTERFACTUAL_READY",
        "sentinel.ledger.recorded": "LEDGER_RECORDED",
        "sentinel.prover.started": "PROVER_STARTED",
        "sentinel.prover.finished": "PROVER_FINISHED",
        "sentinel.training.telemetry": "TRAINING_TELEMETRY",
        "sentinel.preemptive.signature": "PREEMPTIVE_SIGNATURE",
        "sentinel.preemptive.executed": "PREEMPTIVE_EXECUTED",
        "sentinel.preemptive.alert": "PREEMPTIVE_ALERT",
        "sentinel.federation.sync": "FEDERATION_SYNC",
    };
    return map[ch] ?? ch.toUpperCase();
}

export function deriveTrustCues(env: EventEnvelope): TrustCollapseCue[] {
    const cues: TrustCollapseCue[] = [];
    const data = (env.data ?? {}) as Record<string, unknown>;
    const eventId = (data.eventId as string | undefined) ?? null;

    if (env.kind === "THREAT_CONFIRMED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: "AMBIGUITY",
            message: `Threat detected: ${data.pattern ?? "UNKNOWN"}`,
        });
    }
    if (env.kind === "DEFENSE_SUBMITTED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: "SUSPICION",
            message: `Defense tx submitted: ${data.txHash ?? "(pending)"}`,
            underlyingTxHash: (data.txHash as string) ?? null,
        });
    }
    if (env.kind === "DEFENSE_MINED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: "PROOF_INJECTION",
            message: `Defense mined at block #${data.blockNumber ?? "?"}`,
            underlyingTxHash: (data.txHash as string) ?? null,
        });
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: "RESOLVED",
            message: "Action verified on-chain.",
            proofDigest: (data.proofDigest as string) ?? null,
        });
    }
    if (env.kind === "DEFENSE_REJECTED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: "REJECTED",
            message: `FAIL CLOSED — policy proof refused (${data.reason ?? "UNKNOWN"}). No tx was sent.`,
            reason: (data.reason as string) ?? undefined,
            revertReason: (data.revertReason as string) ?? undefined,
        });
    }
    if (env.kind === "DEFENSE_PENDING_APPROVAL") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: "AWAITING_APPROVAL",
            message: `Human gate — defense paused for operator approval (${data.pattern ?? "?"} · conf ${data.confidence ?? "?"})`,
        });
    }
    if (env.kind === "DEFENSE_APPROVAL") {
        const decision = (data.decision as string | undefined) ?? "approve";
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId,
            state: decision === "approve" ? "SUSPICION" : "REJECTED",
            message:
                decision === "approve"
                    ? `Operator approved — defense releasing (${data.approver ?? "?"})`
                    : `Operator rejected — defense abandoned (${data.approver ?? "?"})`,
        });
    }
    return cues;
}
