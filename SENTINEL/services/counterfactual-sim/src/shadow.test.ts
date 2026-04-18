import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("viem", async (importOriginal) => {
    const mod = await importOriginal<typeof import("viem")>();
    return {
        ...mod,
        createPublicClient: vi.fn(() => ({
            waitForTransactionReceipt: vi.fn().mockResolvedValue({
                status: "success",
                gasUsed: 21_000n,
            }),
        })),
    };
});

describe("replayAttack (shadow fork lifecycle)", () => {
    beforeEach(() => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null })))
                .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: null })))
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            jsonrpc: "2.0",
                            id: 3,
                            result: `0x${"ab".repeat(32)}`,
                        }),
                    ),
                ),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("calls anvil_impersonateAccount, anvil_setBalance, then eth_sendTransaction", async () => {
        const { replayAttack } = await import("./shadow.js");
        const hash = await replayAttack({
            forkRpc: "http://127.0.0.1:8545",
            callerAddress: `0x${"1".repeat(40)}` as `0x${string}`,
            attackerContract: `0x${"2".repeat(40)}` as `0x${string}`,
            method: "attack(address,uint256)",
            args: [`0x${"3".repeat(40)}`, 123n],
        });

        const fetchMock = vi.mocked(globalThis.fetch);
        expect(fetchMock.mock.calls.length).toBe(3);
        const methods = fetchMock.mock.calls.map((c) => {
            const body = JSON.parse(c[1]!.body as string);
            return body.method as string;
        });
        expect(methods).toEqual(["anvil_impersonateAccount", "anvil_setBalance", "eth_sendTransaction"]);
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
});
