# Security

StinkBid has **not been audited**. During the beta the API caps orders at 100 USDG per wallet, or 500 and 2,000 USDG for wallets holding 1M and 5M $STINKBID.

## What the contract guarantees

- USDG leaves a maker's wallet only inside a fill of an order the maker signed, and only the signed amount.
- The maker receives at least `minAmountOut` of the signed token, measured at the maker's wallet, or the transaction reverts.
- Each signature works once (Permit2 nonce) and only until its deadline.
- The contract ends every transaction holding no tokens.
- There is no owner, admin, proxy, pause or fee.

## What the keeper key can and cannot do

The keeper is a Cloudflare Worker that sends `fill` transactions from `0x3A61431c290371527f844B71a9C5133c94D0D312`. Its key holds only ETH for gas.

- It cannot move USDG on its own. `fill` needs a maker's signature, and Permit2 checks it.
- It cannot change an order. The amount, token, minimum and deadline are all signed.
- It cannot fill below a maker's minimum. The contract measures what the maker received and reverts otherwise.
- It has no special role on-chain. Anyone can call `fill`, and open orders with their signatures are public at `GET /api/orders/open`.

If the key leaked, the worst case is that someone fills open orders at prices their makers already signed for, or stops filling them. A maker who wants out cancels: the order page revokes the Permit2 nonce on-chain, and that signature stops working for everyone.

## Tokens

The contract does not trust the amount a token or the router says was sent. It measures the change in the maker's balance, so a token that charges a fee on transfer cannot pay the maker less than the minimum. `test_fill_feeOnTransferOutput_measuredAtMaker` checks this.

## Known risks

- A filler chooses when to fill and the route. If the market falls through a bid, a filler can route or sandwich the swap so the maker gets close to the minimum instead of more.
- A fill is never guaranteed: short wicks, thin liquidity, gas or RPC outages.
- The USDG approval sits on Permit2, so any Permit2 signature the maker gives, on any site, can use it.
- Issuers of USDG and of the stock tokens can restrict transfers, which makes fills revert.

## Public review

Instead of an audit badge, anyone can review StinkBid in public: [issue #4](https://github.com/stinkbid/stinkbid/issues/4).

- **Scope:** `contracts/src/StinkBid.sol` (deployed at `0x362917b506695C2096e361Fc032D4315f2439760`, exact match on Sourcify), then the keeper and API in `worker/`.
- **Most wanted:** USDG leaving a wallet without a valid signed order; a fill paying less than `minAmountOut`; a signature used twice, after cancel or after its deadline; tokens left in the contract; ways to block other makers' fills.
- **Credit:** every confirmed finding is listed below with the reviewer's name. There is no paid bounty at the moment.
- **Fixes:** the contract cannot be upgraded. A real fix ships as a new contract at a new address, announced on stinkbid.pro/official first.

### Reviewers

None yet. Be the one.

## Reporting

Report vulnerabilities privately through GitHub: https://github.com/stinkbid/stinkbid/security/advisories/new. Don't open a public issue.
