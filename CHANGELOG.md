# Changelog

What changed on STINKBID, by date. The same list is at https://stinkbid.pro/changelog.

## v0.2.0 (25 November 2026)

Agents can place stink bids; the token turns on holder limits; the review is public.

### 25 November 2026

- MCP server at `https://stinkbid.pro/api/mcp` (Streamable HTTP): `list_markets`, `get_quote`, `get_limits`, `prepare_stink_bid`, `submit_stink_bid`, `get_my_bids`, `get_book`, `prepare_cancel`. The agent signs with its own wallet; the server never holds a key.
- Agent guide at [`/skill.md`](https://stinkbid.pro/skill.md) with a viem signing example, and [`/llms.txt`](https://stinkbid.pro/llms.txt).
- Bids from holder wallets filled on mainnet: 10 USDG on NVDA ([tx](https://robinhoodchain.blockscout.com/tx/0x064e4bb64c6588bf04760a4738ffea11fc05959995fd500875b8e06eed9b4f0e)) and 5 USDG on NVDA from a ladder ([tx](https://robinhoodchain.blockscout.com/tx/0x3baaa6ffc69fc174917bfe2fdf70bbccff785753fbbb38357a8252b172affaf5)).
- Public review opened: [issue #4](https://github.com/stinkbid/stinkbid/issues/4), with scope and credit in SECURITY.md.

### 24 November 2026

- $STINKBID token at `0x5b2c126f4522839110b2ce9d92ff454b26bdc562`. Holding 1M raises a wallet's limit to 500 USDG per bid and 25 open bids; 5M to 2,000 USDG and 50 open. Read from the balance at order time; no fee, no revenue share.
- The token address is on the home page (copy on click), /official, /docs, the README and `/.well-known/stinkbid.json`.

### 23 November 2026

- Two 1 USDG test fills on mainnet (NVDA and MSFT), listed in the README with their transactions.
- Unit tests for the shared config and for order validation run in CI.

## v0.1.0 (22 November 2026)

First tagged version: the contract deployed on Robinhood Chain, the order app, the order API, the keeper and the site.

### 22 November 2026

- Ladders: one form signs 3 or 5 bids at your depth and its multiples.
- "The official price confirms": a bid can wait for the Chainlink price to fall as far as the pool before it becomes active.
- "Only while US markets are closed": a bid can pause during the regular US session.
- The keeper checks about every 10 seconds instead of once a minute.
- The order form shows the Chainlink price, the pool's premium over it and your size's price impact.
- Wallet picker with every installed wallet; a check that your approval covers the order before you sign.

### 21 November 2026, evening

- StinkBid deployed on Robinhood Chain at `0x362917b506695C2096e361Fc032D4315f2439760`, block 119,855,305 ([deploy transaction](https://robinhoodchain.blockscout.com/tx/0x690a9871e316bff9b0900c0a9d07b0328d827e3ccd8e2b9b32b057f70deba381)).
- Source verified on [Sourcify](https://repo.sourcify.dev/4663/0x362917b506695C2096e361Fc032D4315f2439760): exact match for creation and runtime bytecode.

### 21 November 2026

- StinkBid contract written: Permit2 witness orders, USDG in, minimum measured at the maker's wallet, no owner and no fee.
- Tests: 18 unit, 2 fuzz properties, 4 invariants, 2 fork tests on the real NVDA/USDG pool.
- Address fixed in advance with CREATE2: `0x3629…9760`.
- Order app, public order feed, minute keeper and status page.
- Docs, contracts, security and official-links pages.

### 20 November 2026

- Project started. Addresses checked on Robinhood Chain: Permit2, USDG, Uniswap v3 router and quoter.
