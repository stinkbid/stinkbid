# Security

StinkBid has **not been audited**. During the beta the API caps orders at 100 USDG.

## What the contract guarantees

- USDG leaves a maker's wallet only inside a fill of an order the maker signed, and only the signed amount.
- The maker receives at least `minAmountOut` of the signed token, measured at the maker's wallet, or the transaction reverts.
- Each signature works once (Permit2 nonce) and only until its deadline.
- The contract ends every transaction holding no tokens.
- There is no owner, admin, proxy, pause or fee.

## Known risks

- A filler chooses when to fill and the route. If the market falls through a bid, a filler can route or sandwich the swap so the maker gets close to the minimum instead of more.
- A fill is never guaranteed: short wicks, thin liquidity, gas or RPC outages.
- The USDG approval sits on Permit2, so any Permit2 signature the maker gives, on any site, can use it.
- Issuers of USDG and of the stock tokens can restrict transfers, which makes fills revert.

## Reporting

Report vulnerabilities privately. Don't open a public issue. The contact is in https://stinkbid.pro/.well-known/security.txt.
