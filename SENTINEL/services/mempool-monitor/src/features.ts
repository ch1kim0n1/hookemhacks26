import type { TransactionResponse } from "ethers";

export interface TxFeatures {
    hash: string;
    from: string;
    to: string;
    value: string; // bigint-as-string, JSON-safe
    gasPrice: string;
    gasLimit: string;
    nonce: number;
    selector: string; // 0x-prefixed first 4 bytes of data (or "0x")
    decodedArgs: null;
    isFlashLoanOrigin: boolean;
    involvesProtectedProtocol: boolean;
    callGraphDepth: number;
    timestamp: number;
}

export interface MonitorConfig {
    flashLoanProviders: Set<string>; // lower-case addresses
    protectedProtocols: Set<string>; // lower-case
}

export function extractFeatures(tx: TransactionResponse, cfg: MonitorConfig): TxFeatures {
    const to = (tx.to ?? "").toLowerCase();
    const selector = tx.data && tx.data !== "0x" ? tx.data.slice(0, 10) : "0x";
    return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to ?? "",
        value: tx.value.toString(),
        gasPrice: (tx.gasPrice ?? 0n).toString(),
        gasLimit: tx.gasLimit.toString(),
        nonce: tx.nonce,
        selector,
        decodedArgs: null,
        isFlashLoanOrigin: cfg.flashLoanProviders.has(to),
        involvesProtectedProtocol: cfg.protectedProtocols.has(to),
        callGraphDepth: 1,
        timestamp: Date.now(),
    };
}
