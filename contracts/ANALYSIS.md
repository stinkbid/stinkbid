# Static analysis

[Slither](https://github.com/crytic/slither) 0.11 runs on every push and pull request (`.github/workflows/ci.yml`, job `slither`). The job fails on any finding of low severity or above, except the four detectors below. Each one was reviewed against the deployed `StinkBid.sol` and is excluded in `slither.config.json` for the reason given.

This is a record of tool output and why it does not apply. It is not an audit.

Run it locally:

```bash
cd contracts
pip install slither-analyzer
slither .
```

## Excluded detectors

| Detector | Where | Why it does not apply |
|---|---|---|
| `reentrancy-balance` (4 results) | `fill`: `usdgBefore` and `outBefore` are read before the Permit2, approve and router calls and compared after them | Comparing balances before and after those calls is the check itself: it measures what the maker received and proves the contract spent all the USDG it pulled. `fill` is `nonReentrant`, so no call can re-enter it to change either balance. `test_fill_reentryFromRouter_reverts` covers a router that tries. |
| `unused-return` | `fill` ignores the amount `ROUTER.exactInput` returns | On purpose. The contract trusts the maker's balance change, not the router's report, so a fee-on-transfer token or a router that lies cannot under-deliver. `test_fill_routerIgnoringMinimum_stillReverts` and `test_fill_feeOnTransferOutput_measuredAtMaker` cover it. |
| `missing-zero-check` | constructor, `usdg` | The constructor runs once, from `script/Deploy.s.sol`, with fixed addresses. The deployed values can be read from the contract and are listed in the README. |
| `naming-convention` | `PERMIT2`, `ROUTER`, `USDG` | Upper case marks them as immutables, a common style that Slither's naming rule does not include. |

The other 98 detectors report nothing.
