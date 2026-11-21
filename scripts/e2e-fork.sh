#!/bin/sh
# Fresh fork → deploy StinkBid → clear local orders → end-to-end test → stop the fork.
# The public RPC serves only recent state, so the whole run has to start right after the fork does.
# Needs the dev server on :5181 (RPC_URL=http://127.0.0.1:8545 and a KEEPER_KEY in .dev.vars).
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
FORK_RPC="${FORK_RPC:-https://robinhood.drpc.org}"
anvil --fork-url "$FORK_RPC" --port 8545 --chain-id 4663 --silent --no-rate-limit --timeout 120000 --base-fee 20000000 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null' EXIT
until cast block-number -r http://127.0.0.1:8545 >/dev/null 2>&1; do sleep 1; done
# Anvil's default account 0, a public test key, pays for the local deploy only.
(cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --legacy \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 >/dev/null)
npx wrangler d1 execute stinkbid --local --command "DELETE FROM orders; DELETE FROM keeper_runs;" >/dev/null 2>&1
node scripts/e2e-fork.ts
