import { createPublicClient, defineChain, fallback, http, type PublicClient } from "viem";
import { CHAIN_ID, EXPLORER, RPCS } from "../shared/config";

export const robinhood = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

/** The official endpoint refuses some Cloudflare egress IPs, so every call can fall back to public mirrors. */
export function transportFor(rpcUrl?: string) {
  const urls = [...(rpcUrl ? [rpcUrl] : []), ...RPCS];
  return fallback(urls.map((u) => http(u, { timeout: 10_000, retryCount: 1, batch: { wait: 5, batchSize: 50 } })));
}

export function rhClient(rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: robinhood, transport: transportFor(rpcUrl), batch: { multicall: { wait: 5 } } }) as PublicClient;
}
