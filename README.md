# STINKBID

[![ci](https://github.com/stinkbid/stinkbid/actions/workflows/ci.yml/badge.svg)](https://github.com/stinkbid/stinkbid/actions/workflows/ci.yml) [![StinkBid verified on Sourcify](https://img.shields.io/badge/StinkBid-verified%20on%20Sourcify-45b558.svg)](https://repo.sourcify.dev/4663/0x362917b506695C2096e361Fc032D4315f2439760) [![License: MIT](https://img.shields.io/badge/license-MIT-ff3b1f.svg)](LICENSE)

Stink bids for tokenized stocks on Robinhood Chain. You sign a USDG buy order far under the price. It waits off-chain, costs nothing, and becomes one on-chain swap when the market reaches it. Your USDG stays in your wallet until then.

Site: https://stinkbid.pro · App: https://stinkbid.pro/app · Docs: https://stinkbid.pro/docs · Status: https://stinkbid.pro/status

> **Not audited.** Tested as described below. During the beta the API caps orders at 100 USDG.

## How it works

1. The maker approves USDG to [Permit2](https://github.com/Uniswap/permit2) once.
2. The maker signs a Permit2 `PermitWitnessTransferFrom` whose witness is the order: `Order(address maker, address tokenOut, uint256 minAmountOut)`. The spender is StinkBid, and the signature works once and only until its deadline.
3. A keeper, a Cloudflare Worker that checks about every 10 seconds, quotes each open order on Uniswap v3. When the quote reaches `minAmountOut` and the order's optional conditions hold (Chainlink confirms the drop; US market closed), it calls `StinkBid.fill`.
4. `fill` pulls the USDG through Permit2 and swaps it on SwapRouter02 straight to the maker. It then measures the maker's balance change and reverts if that change is under `minAmountOut`.

Anyone can call `fill`. Active orders, signatures included, are public at `GET /api/orders/open`, so the keeper is a convenience, not a gatekeeper. The keeper's key holds only gas money and cannot spend USDG or fill below a signed minimum; [SECURITY.md](SECURITY.md#what-the-keeper-key-can-and-cannot-do) lists what it can do.

## Contracts (Robinhood Chain, 4663)

| | Address |
|---|---|
| StinkBid | [`0x362917b506695C2096e361Fc032D4315f2439760`](https://robinhoodchain.blockscout.com/address/0x362917b506695C2096e361Fc032D4315f2439760) · source [verified on Sourcify](https://repo.sourcify.dev/4663/0x362917b506695C2096e361Fc032D4315f2439760) (exact match) · deployed in block 119,855,305 via CREATE2, salt `keccak256("stinkbid.v1")` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` |

StinkBid has no owner, no fee, no pause and no upgrade path. Between transactions it holds nothing. Markets and pools are listed in [`shared/config.ts`](shared/config.ts) and at https://stinkbid.pro/contracts.

## Tests

```bash
cd contracts
forge test                                                   # unit, fuzz, invariant
FORK_RPC=https://robinhood.drpc.org forge test --match-contract Fork
```

| Suite | What it covers |
|---|---|
| Unit (18) | fills, every revert path, tampered orders, foreign keys, wrong spender, bad paths, reentrancy from the router, a router that ignores the minimum or under-spends, a fee-on-transfer token |
| Fuzz (2 × 1,000 runs) | fills exactly when the swap pays the minimum; no foreign key ever spends |
| Invariant (4 × 256 runs × 64 calls) | the contract holds nothing; USDG leaves makers only through fills; makers always get their price; no altered order fills |
| Fork (2) | real Permit2, USDG, SwapRouter02 and the NVDA/USDG pool: a bid at the market fills, a −15% bid waits |
| End to end (`npm run test:e2e`) | a local fork running the real site API and keeper: forged order rejected → bid placed → oracle-confirmed bid placed → pool falls → keeper fills the pool bid, the oracle bid waits unpublished → maker paid at least the minimum → cancel → spent nonce refused (14 checks) |

Coverage of `StinkBid.sol`: 96% of lines. Slither runs in CI; [contracts/ANALYSIS.md](contracts/ANALYSIS.md) explains each excluded detector. A fill on the NVDA pool costs about 296k gas.

## Layout

```
contracts/          Foundry: StinkBid.sol, tests, CREATE2 deploy script
shared/config.ts    addresses, markets, EIP-712 types, beta limits (site, API and keeper share it)
worker/             Cloudflare Worker (Hono): order API, keeper cron, status
  orders.ts         /api/markets, /quote, /orders, /orders/open, /book
  keeper.ts         every ~10 s: expire, check balance, approval, nonce and conditions, quote, simulate, fill
  status.ts         /api/status from the keeper's run log and the chain
src/app/            order page: wallet, Permit2 approval, typed-data signing, cancel
src/pages/          docs, contracts, security, status, official links, changelog
_pages/             page bodies; `npm run pages` wraps them in the shared shell
migrations/         D1 schema
scripts/e2e-fork.*  end-to-end test on a local fork
```

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

The keeper runs in watch mode, quoting but never sending, until `KEEPER_KEY` is set (`npx wrangler secret put KEEPER_KEY`).

## Deploy the contract

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url robinhood                                   # prints the address
forge script script/Deploy.s.sol --rpc-url robinhood --account <keystore> --broadcast
```

The address depends only on the bytecode and the salt, so anyone who rebuilds this commit gets the same one. Foundry compiles `StinkBid.sol` with the via-IR profile (solc 0.8.28, 1,000,000 runs, cancun) because it imports Permit2's interface; that is the build on-chain and on Sourcify.

## Security

See [SECURITY.md](SECURITY.md) and https://stinkbid.pro/security.

## License

MIT
