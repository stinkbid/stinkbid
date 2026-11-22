# Changelog

What changed on STINKBID, by date. The same list is at https://stinkbid.pro/changelog.

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
