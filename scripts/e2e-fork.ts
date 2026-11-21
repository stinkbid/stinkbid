// End-to-end on a local anvil fork of Robinhood Chain: sign → API → keeper → on-chain fill, plus cancel and a forged order.
// Needs: anvil --fork-url <rpc> --chain-id 4663 on :8545, StinkBid deployed there (forge script ... --legacy),
// the dev server on :5181 with RPC_URL=http://127.0.0.1:8545 and a KEEPER_KEY in .dev.vars.
// Run: node scripts/e2e-fork.ts
import { createPublicClient, createWalletClient, erc20Abi, http, parseAbi, parseUnits, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ADDR, PERMIT2_ABI, marketBySymbol, minOutFor, nonceWord, permitDomain, permitMessage, permitTypes } from "../shared/config.ts";

const RPC = "http://127.0.0.1:8545";
const SITE = "http://localhost:5181";
const chain = { id: 4663, name: "fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 180_000 }) });
// A fresh key per run. (Anvil's well-known test keys carry EIP-7702 delegations on the real chain, so Permit2
// would treat them as contract wallets.)
const maker = privateKeyToAccount(generatePrivateKey());
const keeper = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const NVDA = marketBySymbol("NVDA")!;
const USDG_DONOR = "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3"; // TSLA/USDG pool, not used in this test
const NVDA_DONOR = "0xB944cec30Bd4175855215D767ADC81F39e5f7E2B"; // NVDA/USDG 0.3% pool, not the one we fill on

let failures = 0;
const base = BigInt(Date.now()) << 16n; // fresh nonces per run
const N = (k: bigint) => base + k;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
const wallet = (account: Address | ReturnType<typeof privateKeyToAccount>) => createWalletClient({ chain, account, transport: http(RPC, { timeout: 180_000 }) });

async function asImpersonated(addr: Address, fn: (w: ReturnType<typeof wallet>) => Promise<`0x${string}`>) {
  await rpc("anvil_impersonateAccount", [addr]);
  await rpc("anvil_setBalance", [addr, "0xDE0B6B3A7640000"]);
  const hash = await fn(wallet(addr));
  await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  await rpc("anvil_stopImpersonatingAccount", [addr]);
}

const api = async (path: string, body?: unknown) => {
  const res = await fetch(SITE + path, body ? { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify(body) } : {});
  return { status: res.status, json: await res.json() };
};
const runKeeper = async () => {
  await fetch(`${SITE}/cdn-cgi/handler/scheduled`);
  await new Promise((r) => setTimeout(r, 4000));
};
const quote = async (amount: number) => BigInt((await api(`/api/quote?symbol=NVDA&amount=${amount}`)).json.amountOut);

async function place(amount: number, depthBps: number, nonce: bigint, tamper = false) {
  const amountIn = parseUnits(String(amount), 6);
  const minAmountOut = minOutFor(await quote(amount), depthBps);
  const order = { maker: maker.address, tokenOut: NVDA.token, minAmountOut, amountIn, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 86400) };
  const signature = await maker.signTypedData({ domain: permitDomain, types: permitTypes, primaryType: "PermitWitnessTransferFrom", message: permitMessage(order) });
  return api("/api/orders", {
    symbol: "NVDA", maker: maker.address, amountIn: String(amountIn), minAmountOut: String(tamper ? minAmountOut - 1n : minAmountOut),
    nonce: String(nonce), deadline: String(order.deadline), signature,
  });
}

// 0. Gas for the keeper and the maker, 200 USDG for the maker, one Permit2 approval.
await rpc("anvil_setBalance", [keeper, "0xDE0B6B3A7640000"]);
await rpc("anvil_setBalance", [maker.address, "0xDE0B6B3A7640000"]);
await asImpersonated(USDG_DONOR, (w) => w.writeContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "transfer", args: [maker.address, parseUnits("200", 6)], chain, account: USDG_DONOR }));
const mw = wallet(maker);
await pub.waitForTransactionReceipt({ hash: await mw.writeContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "approve", args: [ADDR.permit2, parseUnits("200", 6)] }) });

// 1. A forged order (minimum changed after signing) is refused by the API.
const forged = await place(50, 100, N(11n), true);
check(forged.status === 400 && forged.json.error === "bad_signature", `forged order rejected (${forged.status} ${forged.json.error})`);

// 2. A real −2% bid is accepted and waits.
const placed = await place(50, 100, N(12n));
check(placed.status === 201, `order accepted (${placed.status} ${JSON.stringify(placed.json)})`);
await runKeeper();
let mine = ((await api(`/api/orders?maker=${maker.address}`)).json.orders as { id: string; status: string; note: string | null; fill_tx: string | null; amount_out: string | null; min_amount_out: string }[]);
const first = mine.find((o) => o.id.endsWith(`:${N(12n)}`))!;
check(first?.status === "open", `bid waits while the market is above it (status ${first?.status}, note ${first?.note})`);

// 3. Someone dumps NVDA into the pool; the price falls through the bid; the keeper fills it.
const before = await pub.readContract({ address: NVDA.token, abi: erc20Abi, functionName: "balanceOf", args: [maker.address] });
const dump = parseUnits("600", 18);
const ROUTER_ABI = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
await asImpersonated(NVDA_DONOR, (w) => w.writeContract({ address: NVDA.token, abi: erc20Abi, functionName: "approve", args: [ADDR.router, dump], chain, account: NVDA_DONOR }));
await asImpersonated(NVDA_DONOR, (w) => w.writeContract({ address: ADDR.router, abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: NVDA.token, tokenOut: ADDR.usdg, fee: NVDA.fee, recipient: NVDA_DONOR, amountIn: dump, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }], chain, account: NVDA_DONOR }));
console.log(`      market moved: 50 USDG now buys ${(await quote(50)).toString()} vs bid minimum ${first.min_amount_out}`);
await runKeeper();
mine = (await api(`/api/orders?maker=${maker.address}`)).json.orders;
const filled = mine.find((o) => o.id.endsWith(`:${N(12n)}`));
if (filled?.status !== "filled") console.log("      keeper said:", filled?.note, JSON.stringify((await api("/api/status")).json.keeper.lastRun));
const after = await pub.readContract({ address: NVDA.token, abi: erc20Abi, functionName: "balanceOf", args: [maker.address] });
check(filled?.status === "filled" && !!filled.fill_tx, `keeper filled the bid (status ${filled?.status}, tx ${filled?.fill_tx?.slice(0, 12)}…)`);
check(after - before >= BigInt(filled?.min_amount_out ?? 0) && after - before === BigInt(filled?.amount_out ?? -1), `maker received ${after - before} ≥ minimum ${filled?.min_amount_out}`);
const sbUsdg = await pub.readContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "balanceOf", args: [ADDR.stinkbid] });
check(sbUsdg === 0n, "contract holds no USDG after the fill");

// 4. A deep bid, cancelled on Permit2 by the maker, is marked cancelled and never fills.
const deep = await place(20, 4000, N(13n));
check(deep.status === 201, `deep bid accepted (${deep.status})`);
const { wordPos, bit } = nonceWord(N(13n));
await pub.waitForTransactionReceipt({ hash: await mw.writeContract({ address: ADDR.permit2, abi: PERMIT2_ABI, functionName: "invalidateUnorderedNonces", args: [wordPos, 1n << bit] }) });
await runKeeper();
mine = (await api(`/api/orders?maker=${maker.address}`)).json.orders;
check(mine.find((o) => o.id.endsWith(`:${N(13n)}`))?.status === "cancelled", `cancelled bid marked cancelled (${mine.find((o) => o.id.endsWith(`:${N(13n)}`))?.status})`);

// 5. Reusing a spent nonce is refused.
const reuse = await place(20, 300, N(13n));
check(reuse.status === 400 && reuse.json.error === "nonce_used", `spent nonce refused (${reuse.status} ${reuse.json.error})`);

// 6. Public surfaces agree.
const book = (await api("/api/book")).json;
check(Number(book.totals.filled) >= 1 && book.fills[0]?.symbol === "NVDA", `book shows the fill (${book.totals.filled} filled)`);
const open = (await api("/api/orders/open")).json;
check(Array.isArray(open.orders) && open.orders.every((o: { signature: string }) => o.signature), `open feed lists ${open.orders.length} open orders with signatures`);
const st = (await api("/api/status")).json;
check(st.keeper.lastRun?.mode === "live" && st.contract.deployed === true, `status: keeper ${st.keeper.lastRun?.mode}, contract deployed ${st.contract.deployed}`);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
