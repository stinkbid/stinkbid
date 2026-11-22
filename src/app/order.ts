import "../landing/landing.css";
import "../pages/pages.css";
import "./order.css";
import "../pages/chrome";
import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";
import {
  ADDR, CHAIN_ID, EXPLORER, LIMITS, PERMIT2_ABI, RPCS, USDG_DECIMALS, marketBySymbol, minOutFor, nonceWord, permitDomain, permitMessage, permitTypes, usMarketOpen, type Market,
} from "../../shared/config";
import { errorText, get, post } from "./api";
import { explorerTx, short } from "../pages/chrome";
import { requestAccount, type Wallet, WalletError } from "./wallet";
import { pickWallet } from "./picker";

const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});

type MarketQuote = Market & { quoteIn: string; quoteOut: string | null; price: number | null; oracle: number | null; premiumBps: number | null };
type Quote = { amountOut: string; impactBps: number | null; oracle: number | null; oracleUpdatedAt: number | null; premiumBps: number | null; marketOpen: boolean };
type Bid = {
  id: string; symbol: string; amount_in: string; min_amount_out: string; nonce: string; deadline: number; depth_bps: number;
  status: "open" | "filled" | "cancelled" | "expired"; note: string | null; fill_tx: string | null; amount_out: string | null; created_at: number;
  fill_on: string; session: string; ladder: string | null; active: number;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const marketSel = $<HTMLSelectElement>("market");
const sizeIn = $<HTMLInputElement>("size");
const depthIn = $<HTMLInputElement>("depth");
const depthOut = $<HTMLOutputElement>("depth-out");
const action = $<HTMLButtonElement>("action");
const statusEl = $<HTMLParagraphElement>("slip-status");
const bidsEl = $<HTMLOListElement>("bids");
const liveNote = $<HTMLParagraphElement>("live-note");

const state = {
  markets: [] as MarketQuote[],
  deployed: false,
  wallet: null as Wallet | null,
  account: null as Address | null,
  quoteOut: null as bigint | null,
  quote: null as Quote | null,
  bids: [] as Bid[],
  busy: false,
  // This wallet's limits from its $STINKBID balance (GET /api/limits); Base until a wallet is connected.
  maxUsdg: LIMITS.maxUsdg as number,
  tier: "Base",
};

const usd = (n: number) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
const tokens = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumSignificantDigits: 5 });
const days = () => Number(document.querySelector<HTMLInputElement>('input[name="days"]:checked')?.value ?? 7);
const pick = (name: string, fallback: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? fallback;
const rungCount = () => Number(pick("rungs", "1"));
const fillOn = () => pick("fillon", "pool") as "pool" | "oracle";
const session = () => pick("session", "any") as "any" | "closed";

/** A ladder of n bids: the size split evenly (remainder on the deepest), at depth, 2×depth, … capped at the beta maximum. */
function rungsFor(size: bigint, depth: number, n: number) {
  const each = size / BigInt(n);
  return Array.from({ length: n }, (_, i) => ({
    amountIn: i === n - 1 ? size - each * BigInt(n - 1) : each,
    depth: Math.min(depth * (i + 1), LIMITS.maxDepthBps / 100),
  }));
}
const market = () => marketBySymbol(marketSel.value)!;
const sizeUnits = () => {
  const n = Number(sizeIn.value);
  return n >= LIMITS.minUsdg && n <= state.maxUsdg ? parseUnits(String(n), USDG_DECIMALS) : null;
};

function say(text: string, kind: "" | "err" | "ok" = "") {
  statusEl.textContent = text;
  statusEl.className = `slip-status ${kind}`;
}

function provider() {
  return state.wallet!.provider as Parameters<typeof custom>[0];
}
const pub = () => createPublicClient({ chain, transport: custom(provider()) });
const wal = () => createWalletClient({ chain, account: state.account!, transport: custom(provider()) });

async function loadMarkets() {
  const r = await get<{ deployed: boolean; markets: MarketQuote[] }>("/api/markets");
  if (!r.ok) {
    $("market-price").textContent = errorText(r.error);
    return;
  }
  state.markets = r.data.markets;
  state.deployed = r.data.deployed;
  const keep = marketSel.value || new URLSearchParams(location.search).get("m") || "NVDA";
  marketSel.innerHTML = state.markets.map((m) => `<option value="${m.symbol}">${m.symbol} · ${m.name}</option>`).join("");
  marketSel.value = marketBySymbol(keep) ? keep : "NVDA";
  liveNote.hidden = state.deployed;
  if (!state.deployed) {
    liveNote.innerHTML = `<strong>The contract is not deployed yet.</strong> You can try the form and see real prices; signing opens once <a href="/contracts">StinkBid</a> is live on Robinhood Chain.`;
  }
  await refreshQuote();
}

let quoteSeq = 0;
async function refreshQuote() {
  const m = market();
  const amount = Number(sizeIn.value);
  const listed = state.markets.find((x) => x.symbol === m.symbol);
  $("market-price").textContent = listed?.price ? `Now about ${usd(listed.price)} USDG per ${m.symbol} on Uniswap.` : "No price from the pool right now.";
  if (!(amount >= LIMITS.minUsdg && amount <= state.maxUsdg)) {
    state.quoteOut = null;
    render();
    return;
  }
  const seq = ++quoteSeq;
  const r = await get<Quote>(`/api/quote?symbol=${m.symbol}&amount=${amount}`);
  if (seq !== quoteSeq) return;
  state.quote = r.ok ? r.data : null;
  state.quoteOut = r.ok ? BigInt(r.data.amountOut) : null;
  render();
}

function render() {
  const m = market();
  const depth = Number(depthIn.value);
  const n = rungCount();
  depthOut.textContent = n > 1 ? `−${depth}% to −${Math.min(depth * n, LIMITS.maxDepthBps / 100)}%` : `−${depth}%`;
  const size = sizeUnits();
  const q = state.quote;
  const rungsOk = !!size && size / BigInt(n) >= BigInt(LIMITS.minUsdg) * 10n ** BigInt(USDG_DECIMALS);

  $("rungs-help").textContent = n === 1 ? "The whole size at one level." : `${n} bids of about ${size ? usd(Number(formatUnits(size / BigInt(n), USDG_DECIMALS))) : "–"} USDG each, one under the other. Each one is signed separately.`;
  $("fillon-help").textContent = fillOn() === "pool"
    ? "Fills as soon as the Uniswap pool pays your price."
    : "Waits until Chainlink's price for the stock has also fallen this far, so a dip that only happens in the pool doesn't fill it.";
  const open = q?.marketOpen ?? usMarketOpen();
  $("session-help").textContent = session() === "any"
    ? `US market is ${open ? "open" : "closed"} right now.`
    : `Waits while the US market is open (9:30 to 16:00 New York time, weekdays). It is ${open ? "open now, so this bid starts paused" : "closed now, so this bid is active"}.`;

  if (size && state.quoteOut && rungsOk) {
    const rungs = rungsFor(size, depth, n);
    const mins = rungs.map((r) => minOutFor((state.quoteOut! * r.amountIn) / size, r.depth * 100));
    const totalMin = mins.reduce((a, b) => a + b, 0n);
    const levels = rungs.map((r, i) => Number(formatUnits(r.amountIn, USDG_DECIMALS)) / Number(formatUnits(mins[i], m.decimals)));
    const now = Number(formatUnits(size, USDG_DECIMALS)) / Number(formatUnits(state.quoteOut, m.decimals));
    $("r-bid").textContent = n === 1 ? `${formatUnits(size, USDG_DECIMALS)} USDG on ${m.symbol}` : `${n} × ${usd(Number(formatUnits(rungs[0].amountIn, USDG_DECIMALS)))} USDG on ${m.symbol}`;
    $("r-min").textContent = `${tokens(totalMin, m.decimals)} ${m.symbol}${n > 1 ? " if all fill" : ""}`;
    $("r-level").textContent = n === 1 ? `${usd(levels[0])} USDG (now ${usd(now)})` : `${levels.map(usd).join(" · ")} (now ${usd(now)})`;
  } else {
    for (const id of ["r-bid", "r-min", "r-level"]) $(id).textContent = "–";
  }
  $("r-oracle").textContent = q?.oracle ? `${usd(q.oracle)} USD${q.premiumBps != null ? ` · pool ${q.premiumBps >= 0 ? "+" : "−"}${(Math.abs(q.premiumBps) / 100).toFixed(2)}%` : ""}` : "–";
  $("r-impact").textContent = q?.impactBps != null ? (q.impactBps < 1 ? "under 0.01%" : `${(q.impactBps / 100).toFixed(2)}%`) : "–";
  const warn = $("impact-warn");
  warn.hidden = !(q?.impactBps != null && q.impactBps >= 100);
  if (!warn.hidden) warn.textContent = `This pool is thin: your size alone moves the price ${(q!.impactBps! / 100).toFixed(1)}%. A smaller size or a ladder fills closer to your level.`;

  if (!state.busy) {
    action.disabled = false;
    if (!state.account) action.textContent = "Connect wallet";
    else if (!state.deployed) { action.textContent = "Signing opens when the contract is live"; action.disabled = true; }
    else if (!size) { action.textContent = `Enter ${LIMITS.minUsdg} to ${state.maxUsdg} USDG`; action.disabled = true; }
    else if (!rungsOk) { action.textContent = `At least ${LIMITS.minUsdg * n} USDG for ${n} bids`; action.disabled = true; }
    else action.textContent = n === 1 ? "Sign the stink bid" : `Sign ${n} stink bids`;
  }
}

async function connect() {
  const wallet = await pickWallet();
  if (!wallet) return;
  const account = getAddress(await requestAccount(wallet));
  state.wallet = wallet;
  state.account = account;
  showWho();
  (wallet.provider as { on?: (e: string, f: (a: string[]) => void) => void }).on?.("accountsChanged", (a) => {
    if (state.wallet !== wallet) return;
    state.account = a[0] ? getAddress(a[0]) : null;
    showWho();
    void loadBids();
    void loadLimits();
    render();
  });
  say("");
  await ensureChain();
  await Promise.all([loadBids(), loadLimits()]);
}

type Limits = { token: string | null; tier: string; maxUsdg: number; maxOpen: number };
/** Reads this wallet's bid limits; holding $STINKBID raises them. Base when no wallet or no answer. */
async function loadLimits() {
  const help = $("size-help");
  if (!state.account) {
    state.maxUsdg = LIMITS.maxUsdg;
    state.tier = "Base";
  } else {
    const r = await get<Limits>(`/api/limits?address=${state.account}`);
    state.maxUsdg = r.ok ? r.data.maxUsdg : LIMITS.maxUsdg;
    state.tier = r.ok ? r.data.tier : "Base";
  }
  sizeIn.max = String(state.maxUsdg);
  help.textContent = state.tier === "Base" ? `${LIMITS.minUsdg} to ${state.maxUsdg} USDG per order during the beta.` : `${LIMITS.minUsdg} to ${state.maxUsdg} USDG per order: ${state.tier} limit from your $STINKBID balance.`;
  await refreshQuote();
}

function showWho() {
  const who = $("who");
  who.replaceChildren();
  if (!state.account) return;
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "who-switch";
  sw.textContent = "Switch";
  sw.addEventListener("click", () => guard(connect));
  who.append(`${state.wallet?.name ?? "Wallet"} · ${short(state.account)} `, sw);
}

async function ensureChain() {
  const p = provider();
  const id = Number(await p.request({ method: "eth_chainId" }));
  if (id === CHAIN_ID) return;
  const hex = `0x${CHAIN_ID.toString(16)}`;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: RPCS.slice(0, 2), blockExplorerUrls: [EXPLORER] }],
    });
  }
}

/** USDG Permit2 may pull: every open bid plus the new one. Approving that sum, not "unlimited". */
async function ensureAllowance(amount: bigint) {
  const client = pub();
  const owner = state.account!;
  const [balance, allowance] = await Promise.all([
    client.readContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "allowance", args: [owner, ADDR.permit2] }),
  ]);
  if (balance < amount) throw Object.assign(new Error("not_enough_usdg"), { code: "not_enough_usdg" });
  const openSum = state.bids.filter((b) => b.status === "open").reduce((s, b) => s + BigInt(b.amount_in), 0n);
  const need = openSum + amount;
  if (allowance >= need) return;
  say(`Approve ${formatUnits(need, USDG_DECIMALS)} USDG for Permit2 in your wallet. Keep the amount your wallet shows; a lower cap blocks the order.`);
  const hash = await wal().writeContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "approve", args: [ADDR.permit2, need] });
  say("Waiting for the approval to confirm…");
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw Object.assign(new Error("approve_failed"), { code: "approve_failed" });
  const after = await client.readContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "allowance", args: [owner, ADDR.permit2] });
  if (after < need) throw Object.assign(new Error("approval_too_low"), { code: "approval_too_low" });
}

function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return b.reduce((n, x) => (n << 8n) | BigInt(x), 0n) + 1n;
}

async function signBid() {
  const m = market();
  const size = sizeUnits()!;
  const n = rungCount();
  const rungs = rungsFor(size, Number(depthIn.value), n);
  const ladder = n > 1 ? [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("") : undefined;
  await ensureChain();
  await ensureAllowance(size);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + days() * 86400);
  let placed = 0;
  for (const [i, rung] of rungs.entries()) {
    const q = await get<{ amountOut: string }>(`/api/quote?symbol=${m.symbol}&amount=${formatUnits(rung.amountIn, USDG_DECIMALS)}`);
    if (!q.ok) throw Object.assign(new Error(q.error), { code: q.error });
    const minAmountOut = minOutFor(BigInt(q.data.amountOut), rung.depth * 100);
    const order = { maker: state.account!, tokenOut: m.token, minAmountOut, amountIn: rung.amountIn, nonce: randomNonce(), deadline };
    say(n === 1 ? "Sign the order in your wallet. This is a signature, not a transaction." : `Sign bid ${i + 1} of ${n} (−${rung.depth}%) in your wallet. Signatures only, no transactions.`);
    const signature: Hex = await wal().signTypedData({ domain: permitDomain, types: permitTypes, primaryType: "PermitWitnessTransferFrom", message: permitMessage(order) });
    const r = await post<{ id: string }>("/api/orders", {
      symbol: m.symbol, maker: order.maker, amountIn: String(order.amountIn), minAmountOut: String(minAmountOut), nonce: String(order.nonce), deadline: String(deadline), signature,
      fillOn: fillOn(), session: session(), ladder,
    });
    if (!r.ok) {
      if (placed) await loadBids();
      throw Object.assign(new Error(r.error), { code: r.error });
    }
    placed++;
  }
  const what = n === 1 ? `${formatUnits(size, USDG_DECIMALS)} USDG on ${m.symbol}, −${depthIn.value}%` : `${n} bids on ${m.symbol}, −${rungs[0].depth}% to −${rungs[n - 1].depth}%`;
  say(`Placed: ${what}. The keeper checks about every 10 seconds.`, "ok");
  await loadBids();
}

async function cancelBid(b: Bid) {
  const { wordPos, bit } = nonceWord(BigInt(b.nonce));
  await ensureChain();
  const hash = await wal().writeContract({ address: ADDR.permit2, abi: PERMIT2_ABI, functionName: "invalidateUnorderedNonces", args: [wordPos, 1n << bit] });
  say("Cancelling on-chain…");
  await pub().waitForTransactionReceipt({ hash });
  say("Cancelled. The signature can no longer be used by anyone.", "ok");
  setTimeout(loadBids, 70_000);
}

/** The conditions of an open bid, and whether they hold right now. */
function cond(b: Bid) {
  const parts = [b.fill_on === "oracle" ? "official price confirms" : "", b.session === "closed" ? "US market closed only" : ""].filter(Boolean);
  if (b.status !== "open" || parts.length === 0) return "";
  return ` · ${parts.join(", ")} · ${b.active ? "active" : "waiting"}`;
}

async function loadBids() {
  if (!state.account) return;
  const r = await get<{ orders: Bid[] }>(`/api/orders?maker=${state.account}`);
  state.bids = r.ok ? r.data.orders : [];
  if (state.bids.length === 0) {
    bidsEl.innerHTML = `<li class="empty">No bids from this wallet yet.</li>`;
    return;
  }
  bidsEl.innerHTML = "";
  for (const b of state.bids) {
    const m = marketBySymbol(b.symbol)!;
    const li = document.createElement("li");
    const ends = new Date(b.deadline * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    const got = b.amount_out ? `Bought ${tokens(BigInt(b.amount_out), m.decimals)} ${m.symbol}` : `At least ${tokens(BigInt(b.min_amount_out), m.decimals)} ${m.symbol}`;
    const note = b.status === "open" && b.note ? ` · ${b.note === "unfunded" ? "not enough USDG in the wallet" : b.note === "no_allowance" ? "Permit2 approval too low" : "last fill attempt failed, retrying"}` : "";
    li.innerHTML = `
      <span class="bid-main">${formatUnits(BigInt(b.amount_in), USDG_DECIMALS)} USDG · ${b.symbol} · −${(b.depth_bps / 100).toFixed(0)}%</span>
      <span class="bid-sub">${got}${b.status === "open" ? ` · until ${ends}` : ""}${cond(b)}${note}</span>
      <span class="bid-side"><span class="pill ${b.status}">${b.status}</span></span>`;
    const side = li.querySelector(".bid-side")!;
    if (b.fill_tx) {
      const a = document.createElement("a");
      a.href = explorerTx(b.fill_tx);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Fill tx";
      side.append(a);
    }
    if (b.status === "open") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Cancel";
      btn.addEventListener("click", () => guard(() => cancelBid(b)));
      side.append(btn);
    }
    bidsEl.append(li);
  }
}

async function guard(fn: () => Promise<void>) {
  if (state.busy) return;
  state.busy = true;
  action.disabled = true;
  try {
    await fn();
  } catch (err) {
    const code = (err as { code?: string | number })?.code;
    say(code === 4001 ? errorText("user_rejected") : typeof code === "string" ? errorText(code) : err instanceof WalletError ? errorText(err.code) : errorText("wallet_error"), "err");
  } finally {
    state.busy = false;
    render();
  }
}

action.addEventListener("click", () => guard(async () => (state.account ? signBid() : connect())));
marketSel.addEventListener("change", refreshQuote);
let t: number | undefined;
sizeIn.addEventListener("input", () => {
  clearTimeout(t);
  render();
  t = window.setTimeout(refreshQuote, 350);
});
depthIn.addEventListener("input", render);
document.querySelectorAll<HTMLInputElement>('input[name="rungs"], input[name="fillon"], input[name="session"]').forEach((el) => el.addEventListener("change", render));
setInterval(refreshQuote, 30_000);
setInterval(loadBids, 60_000);
loadMarkets();
