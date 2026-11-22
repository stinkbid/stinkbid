import { erc20Abi, type Address, type PublicClient } from "viem";
import { TIERS, tierFor, type Tier } from "../shared/config";
import { TOKEN, TOKEN_DECIMALS, TOKEN_SYMBOL } from "../shared/token";

export type Limits = { token: Address | null; symbol: string; balance: string; tier: Tier["name"]; maxUsdg: number; maxOpen: number; tiers: typeof TIERS };

/** A wallet's bid limits from its $STINKBID balance. With no token yet, everyone is Base. */
export async function limitsFor(client: PublicClient, maker: Address): Promise<Limits> {
  let balance = 0n;
  if (TOKEN) balance = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [maker] });
  const t = tierFor(balance, TOKEN_DECIMALS);
  return { token: TOKEN, symbol: TOKEN_SYMBOL, balance: balance.toString(), tier: t.name, maxUsdg: t.maxUsdg, maxOpen: t.maxOpen, tiers: TIERS };
}
