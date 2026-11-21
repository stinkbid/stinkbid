import "../landing/landing.css";
import "../pages/pages.css";
import "./order.css";
import "../pages/chrome";
import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";
import {
  ADDR, CHAIN_ID, EXPLORER, LIMITS, PERMIT2_ABI, RPCS, USDG_DECIMALS, marketBySymbol, minOutFor, nonceWord, permitDomain, permitMessage, permitTypes, type Market,
} from "../../shared/config";
import { errorText, get, post } from "./api";
import { explorerTx, short } from "../pages/chrome";
import { discoverWallets, requestAccount, WalletError, type Wallet } from "./wallet";

const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});

type MarketQuote = Market & { quoteIn: string; quoteOut: string | null; price: number | null };
type Bid = {
  id: string; symbol: string; amount_in: string; min_amount_out: string; nonce: string; deadline: number; depth_bps: number;
  status: "open" | "filled" | "cancelled" | "expired"; note: string | null; fill_tx: string | null; amount_out: string | null; created_at: number;
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
  bids: [] as Bid[],
  busy: false,
};

const usd = (n: number) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
const tokens = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumSignificantDigits: 5 });
const days = () => Number(document.querySelector<HTMLInputElement>('input[name="days"]:checked')?.value ?? 7);
const market = () => marketBySymbol(marketSel.value)!;
const sizeUnits = () => {
  const n = Number(sizeIn.value);
  return n >= LIMITS.minUsdg && n <= LIMITS.maxUsdg ? parseUnits(String(n), USDG_DECIMALS) : null;
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
  if (!(amount >= LIMITS.minUsdg && amount <= LIMITS.maxUsdg)) {
    state.quoteOut = null;
    render();
    return;
  }
  const seq = ++quoteSeq;
  const r = await get<{ amountOut: string }>(`/api/quote?symbol=${m.symbol}&amount=${amount}`);
  if (seq !== quoteSeq) return;
  state.quoteOut = r.ok ? BigInt(r.data.amountOut) : null;
  render();
}

function render() {
  const m = market();
  const depth = Number(depthIn.value);
  depthOut.textContent = `−${depth}%`;
  const size = sizeUnits();
  if (size && state.quoteOut) {
    const min = minOutFor(state.quoteOut, depth * 100);
    const level = Number(formatUnits(size, USDG_DECIMALS)) / Number(formatUnits(min, m.decimals));
    const now = Number(formatUnits(size, USDG_DECIMALS)) / Number(formatUnits(state.quoteOut, m.decimals));
    $("r-bid").textContent = `${formatUnits(size, USDG_DECIMALS)} USDG on ${m.symbol}`;
    $("r-min").textContent = `${tokens(min, m.decimals)} ${m.symbol}`;
    $("r-level").textContent = `${usd(level)} USDG (now ${usd(now)})`;
  } else {
    for (const id of ["r-bid", "r-min", "r-level"]) $(id).textContent = "–";
  }
  if (!state.busy) {
    action.disabled = false;
    if (!state.account) action.textContent = "Connect wallet";
    else if (!state.deployed) { action.textContent = "Signing opens when the contract is live"; action.disabled = true; }
    else if (!size) { action.textContent = `Enter ${LIMITS.minUsdg} to ${LIMITS.maxUsdg} USDG`; action.disabled = true; }
    else action.textContent = "Sign the stink bid";
  }
}

async function connect() {
  const wallets = await discoverWallets();
  if (wallets.length === 0) throw new WalletError("wallet_error");
  state.wallet = wallets[0];
  state.account = getAddress(await requestAccount(state.wallet));
  $("who").textContent = short(state.account);
  await ensureChain();
  await loadBids();
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
  say(`Approve ${formatUnits(need, USDG_DECIMALS)} USDG for Permit2 in your wallet…`);
  const hash = await wal().writeContract({ address: ADDR.usdg, abi: erc20Abi, functionName: "approve", args: [ADDR.permit2, need] });
  say("Waiting for the approval to confirm…");
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("approve_failed");
}

function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return b.reduce((n, x) => (n << 8n) | BigInt(x), 0n) + 1n;
}

async function signBid() {
  const m = market();
  const amountIn = sizeUnits()!;
  await ensureChain();
  await ensureAllowance(amountIn);
  const q = await get<{ amountOut: string }>(`/api/quote?symbol=${m.symbol}&amount=${formatUnits(amountIn, USDG_DECIMALS)}`);
  if (!q.ok) throw Object.assign(new Error(q.error), { code: q.error });
  const minAmountOut = minOutFor(BigInt(q.data.amountOut), Number(depthIn.value) * 100);
  const order = {
    maker: state.account!,
    tokenOut: m.token,
    minAmountOut,
    amountIn,
    nonce: randomNonce(),
    deadline: BigInt(Math.floor(Date.now() / 1000) + days() * 86400),
  };
  say("Sign the order in your wallet. This is a signature, not a transaction.");
  const signature: Hex = await wal().signTypedData({ domain: permitDomain, types: permitTypes, primaryType: "PermitWitnessTransferFrom", message: permitMessage(order) });
  const r = await post<{ id: string }>("/api/orders", {
    symbol: m.symbol, maker: order.maker, amountIn: String(amountIn), minAmountOut: String(minAmountOut), nonce: String(order.nonce), deadline: String(order.deadline), signature,
  });
  if (!r.ok) throw Object.assign(new Error(r.error), { code: r.error });
  say(`Placed: ${formatUnits(amountIn, USDG_DECIMALS)} USDG on ${m.symbol}, −${depthIn.value}%. The keeper checks it every minute.`, "ok");
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
      <span class="bid-sub">${got}${b.status === "open" ? ` · until ${ends}` : ""}${note}</span>
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
setInterval(refreshQuote, 30_000);
setInterval(loadBids, 60_000);
loadMarkets();
