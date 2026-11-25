# Contributing

Bug reports and pull requests are welcome. For a security issue, don't open an issue: follow [SECURITY.md](SECURITY.md).

## Before a pull request

```bash
cd contracts && forge test && slither .         # contract
npm run typecheck && npm test && npm run build   # site, API and keeper
npm run test:e2e                                # full flow on a local fork (needs anvil)
```

CI runs the same checks, plus the fork tests against Robinhood Chain and a gitleaks secret scan of the full history (`gitleaks git . --config .gitleaks.toml`). Never commit a key: local secrets go in `.dev.vars`, which is ignored.

## The deployed contract

`StinkBid.sol` is deployed at `0x362917b506695C2096e361Fc032D4315f2439760` and has no upgrade path. A change to the contract means a new deployment at a new address, so it needs a clear reason, new tests and an entry in the changelog. Changes to the site, API and keeper ship continuously.

## Style

- Solidity: custom errors, not revert strings. NatSpec on every external function.
- TypeScript: strict mode. Addresses and types come from `shared/config.ts`, never inline.
- Commits: one change per commit, with a message that says what changed.
