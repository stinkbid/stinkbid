import { erc20Abi, type Address, type Hex, type PublicClient } from "viem";
import { ADDR, MARKETS, PERMIT2_ABI, QUOTER_ABI, nonceWord, pathFor, USDG_DECIMALS, type Market } from "../shared/config";

export const QUOTE_SIZE = 100n * 10n ** BigInt(USDG_DECIMALS);

export async function isDeployed(client: PublicClient): Promise<boolean> {
  const code = await client.getCode({ address: ADDR.stinkbid });
  return !!code && code !== "0x";
}

/** QuoterV2 output for each (path, amountIn), or null where the quote reverted. One multicall. */
export async function quoteMany(client: PublicClient, items: { path: Hex; amountIn: bigint }[]): Promise<(bigint | null)[]> {
  if (items.length === 0) return [];
  const res = await client.multicall({
    contracts: items.map((i) => ({ address: ADDR.quoter, abi: QUOTER_ABI, functionName: "quoteExactInput", args: [i.path, i.amountIn] }) as const),
    allowFailure: true,
  });
  return res.map((r) => (r.status === "success" ? (r.result as readonly [bigint, ...unknown[]])[0] : null));
}

export type MarketQuote = Market & { quoteIn: string; quoteOut: string | null; price: number | null };

/** Price per token in USDG for a 100 USDG buy on each market's pool. */
export async function marketQuotes(client: PublicClient): Promise<MarketQuote[]> {
  const outs = await quoteMany(client, MARKETS.map((m) => ({ path: pathFor(m), amountIn: QUOTE_SIZE })));
  return MARKETS.map((m, i) => {
    const out = outs[i];
    const price = out ? Number(QUOTE_SIZE) / 10 ** USDG_DECIMALS / (Number(out) / 10 ** m.decimals) : null;
    return { ...m, quoteIn: QUOTE_SIZE.toString(), quoteOut: out?.toString() ?? null, price };
  });
}

export type MakerState = { usdg: bigint; allowance: bigint; nonceUsed: boolean };

/** USDG balance, USDG allowance to Permit2 and whether the Permit2 nonce is spent, for many (maker, nonce). */
export async function makerStates(client: PublicClient, rows: { maker: Address; nonce: bigint }[]): Promise<MakerState[]> {
  if (rows.length === 0) return [];
  const calls = rows.flatMap((r) => {
    const { wordPos } = nonceWord(r.nonce);
    return [
      { address: ADDR.usdg, abi: erc20Abi, functionName: "balanceOf", args: [r.maker] },
      { address: ADDR.usdg, abi: erc20Abi, functionName: "allowance", args: [r.maker, ADDR.permit2] },
      { address: ADDR.permit2, abi: PERMIT2_ABI, functionName: "nonceBitmap", args: [r.maker, wordPos] },
    ] as const;
  });
  const res = await client.multicall({ contracts: calls as never, allowFailure: false });
  return rows.map((r, i) => {
    const bitmap = res[3 * i + 2] as bigint;
    return {
      usdg: res[3 * i] as bigint,
      allowance: res[3 * i + 1] as bigint,
      nonceUsed: ((bitmap >> nonceWord(r.nonce).bit) & 1n) === 1n,
    };
  });
}
