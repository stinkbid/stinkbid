---
name: stinkbid
description: Place non-custodial stink bids (limit buys under the price) for tokenized stocks on Robinhood Chain with STINKBID. Use when an agent wants to buy a stock token such as NVDA, TSLA or AAPL only if its price falls to a level, without depositing funds anywhere.
---

# STINKBID for agents

A stink bid is a buy order parked under today's price. The maker signs it once; USDG stays in the maker's wallet; when the pool reaches the level, a filler calls the StinkBid contract, which swaps the USDG for the stock token and sends it straight to the maker. If the maker would receive less than the signed minimum, the transaction reverts.

- Chain: Robinhood Chain, id 4663
- Contract: `0x362917b506695C2096e361Fc032D4315f2439760` (source verified on Sourcify, exact match; no owner, no upgrade, no fee)
- Spends: USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` through Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Not audited. Use small amounts.

## Connect

MCP server (Streamable HTTP, no auth): `https://stinkbid.pro/api/mcp`

Claude Code:

```
claude mcp add --transport http stinkbid https://stinkbid.pro/api/mcp
```

Cursor / any MCP client (`mcp.json`):

```json
{ "mcpServers": { "stinkbid": { "url": "https://stinkbid.pro/api/mcp" } } }
```

## Tools

| Tool | What it does |
|---|---|
| `list_markets` | Supported stock tokens, pool price (USDG), Chainlink price, gap, limits, tiers |
| `get_quote` | What a USDG amount buys now, with price impact |
| `get_limits` | A wallet's limits from its $STINKBID balance |
| `prepare_stink_bid` | EIP-712 typed data to sign (one per ladder rung), plus the USDG balance and Permit2 approval check |
| `submit_stink_bid` | Posts one signed order |
| `get_my_bids` | A wallet's bids and fill transactions |
| `get_book` | Open bids per market and recent fills |
| `prepare_cancel` | The Permit2 transaction that cancels a bid |

## Flow

1. `list_markets` and pick a `symbol`.
2. `prepare_stink_bid` with `maker`, `symbol`, `amount_usdg`, `depth_pct` (1 to 50), optional `days`, `rungs` (1, 3 or 5), `fill_on` (`pool` or `oracle`), `session` (`any` or `closed`).
3. If `approval_needed` is set, send that transaction once from the maker's wallet. It approves Permit2 to use USDG; it moves no funds.
4. Sign each rung's `typedData` with the maker's own key (`eth_signTypedData_v4`).
5. `submit_stink_bid` with that rung's `order` and the signature.
6. Check later with `get_my_bids`. A fill shows `fill_tx`.

Never send a private key or seed phrase to the server or to anyone. The server never needs one: it only builds data to sign and checks signatures.

## Signing with viem

The typed data comes back with big numbers as strings. Turn them into bigints before signing:

```ts
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.MAKER_KEY as `0x${string}`); // stays on your machine
const big = (v: unknown): unknown =>
  typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : Array.isArray(v) ? v.map(big) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, big(x)])) : v;

for (const rung of prepared.rungs) {
  const td = big(rung.typedData) as any;
  td.domain.chainId = Number(td.domain.chainId);
  const signature = await account.signTypedData(td);
  // call the MCP tool submit_stink_bid with { order: rung.order, signature }
}
```

## Limits

- 1 to 100 USDG per bid and 10 open bids for any wallet; 500 USDG and 25 open with 1M $STINKBID; 2,000 USDG and 50 open with 5M. Read at order time from the on-chain balance.
- Depth 1% to 50% under the current pool fill. Expiry 1 to 30 days.
- The keeper checks open bids about every 10 seconds. Conditions (`oracle`, `closed`) are applied by the keeper; the contract enforces the signed minimum.

## Errors you may see

`not_enough_usdg`, `no_allowance` (do the approval), `over_tier_limit`, `too_many_open`, `depth_out_of_range`, `bad_signature`, `nonce_used`, `rate_limited`.

More: https://stinkbid.pro/docs · source: https://github.com/stinkbid/stinkbid · security: https://stinkbid.pro/security
