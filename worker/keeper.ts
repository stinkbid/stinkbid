// The keeper: about every 10 seconds (five passes per cron minute), check every open order and fill the ones the market has reached.
// It can only call StinkBid.fill with an order exactly as signed; the contract checks the price on-chain.
import { createWalletClient, decodeEventLog, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR, EXPLORER, STINKBID_ABI, marketBySymbol, usMarketOpen, type Market } from "../shared/config";
import { isActive, isDeployed, makerStates, oraclePrices, quoteMany, type OraclePrice } from "./market";
import { rhClient, robinhood, transportFor } from "./rh";

const MAX_FILLS_PER_RUN = 5;
const MIN_KEEPER_ETH = 50_000_000_000_000n; // 0.00005 ETH, a few hundred fills at today's gas price
const MAX_FEE_PER_GAS = 1_000_000_000n; // 1 gwei; the chain has been at ~0.02 gwei

type OpenRow = {
  id: string; maker: string; symbol: string; token_out: string; path: string; amount_in: string; min_amount_out: string; nonce: string; deadline: number; signature: string;
  fill_on: string; oracle_level: string | null; session: string; active: number;
};

const PASSES = 5; // passes at 0, 10, 20, 30 and 40 s, so a slow fill still ends before the next cron minute
const PASS_EVERY_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const now = () => Math.floor(Date.now() / 1000);

const TIP_WEI = 1_000n;

// Robinhood Chain (Arbitrum Orbit) ignores priority tips, so pay twice the base fee and no meaningful tip.
// Throws above MAX_FEE_PER_GAS so a gas spike never drains the keeper.
export function fillFees(baseFeePerGas: bigint | null | undefined): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const maxFeePerGas = (baseFeePerGas ?? 0n) * 2n + TIP_WEI;
  if (maxFeePerGas > MAX_FEE_PER_GAS) throw new Error(`gas too high: ${maxFeePerGas}`);
  return { maxFeePerGas, maxPriorityFeePerGas: TIP_WEI };
}

export function keeperAddress(env: Env): Address | null {
  const key = env.KEEPER_KEY?.trim();
  if (!key) return null;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex).address;
}

/** Blockscout's Etherscan-style log API, used only to tell a third-party fill apart from a cancel. */
async function findFill(maker: string, nonce: string): Promise<{ tx: string; amountOut: string; filler: string } | null> {
  const topic0 = keccak256(toHex("Filled(address,uint256,address,uint256,uint256,address)"));
  const pad = (h: string) => "0x" + h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const url = `${EXPLORER}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${ADDR.stinkbid}&topic0=${topic0}&topic1=${pad(maker)}&topic2=${pad(BigInt(nonce).toString(16))}&topic0_1_opr=and&topic1_2_opr=and`;
  const res = await fetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as { result?: { transactionHash: string; data: Hex; topics: Hex[] }[] } | null;
  const log = Array.isArray(json?.result) ? json!.result[0] : undefined;
  if (!log) return null;
  const ev = decodeEventLog({ abi: STINKBID_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
  const args = ev.args as { amountOut: bigint; filler: Address };
  return { tx: log.transactionHash, amountOut: args.amountOut.toString(), filler: args.filler };
}

export async function runKeeper(env: Env): Promise<void> {
  const db = env.DB;
  const started = now();
  const t0 = Date.now();
  const key = env.KEEPER_KEY?.trim();
  const run = await db.prepare("INSERT INTO keeper_runs (started_at, mode) VALUES (?1, ?2) RETURNING id").bind(started, key ? "live" : "watch").first<{ id: number }>();
  const stats = { mode: key ? "live" : "watch", block: null as number | null, checked: 0, fillable: 0, filled: 0, error: null as string | null };
  try {
    const passes = Math.min(PASSES, Math.max(1, Number(env.KEEPER_PASSES ?? PASSES) || PASSES));
    for (let i = 0; i < passes; i++) {
      await pass(env, stats);
      if (stats.mode === "waiting_for_contract") break;
      const next = (i + 1) * PASS_EVERY_MS - (Date.now() - t0);
      if (i < passes - 1 && next > 0) await sleep(next);
    }
  } finally {
    await db.prepare("UPDATE keeper_runs SET finished_at = ?2, mode = ?3, block = ?4, checked = ?5, fillable = ?6, filled = ?7, error = ?8 WHERE id = ?1")
      .bind(run?.id ?? 0, now(), stats.mode, stats.block, stats.checked, stats.fillable, stats.filled, stats.error).run();
    if (Math.random() < 0.02) await db.prepare("DELETE FROM keeper_runs WHERE started_at < ?1").bind(started - 3 * 86400).run();
  }
}

type Stats = { mode: string; block: number | null; checked: number; fillable: number; filled: number; error: string | null };

/** One check of every open order. Stats keep the latest block and error and the largest counts of the minute. */
async function pass(env: Env, stats: Stats): Promise<void> {
  const db = env.DB;
  const started = now();
  const client = rhClient(env.RPC_URL);
  const key = env.KEEPER_KEY?.trim();

  try {
    stats.block = Number(await client.getBlockNumber());
    if (!(await isDeployed(client))) {
      stats.mode = "waiting_for_contract";
      return;
    }

    await db.prepare("UPDATE orders SET status = 'expired', closed_at = ?1 WHERE status = 'open' AND deadline <= ?1").bind(started).run();
    const { results: open } = await db.prepare("SELECT * FROM orders WHERE status = 'open' ORDER BY created_at LIMIT 300").all<OpenRow>();
    if (open.length === 0) return;
    stats.checked = Math.max(stats.checked, open.length);

    // Official prices only for markets that have an oracle order.
    const oracleMarkets = [...new Set(open.filter((o) => o.fill_on === "oracle").map((o) => o.symbol))].map((sym) => marketBySymbol(sym)).filter(Boolean) as Market[];
    const [states, quotes, feeds] = await Promise.all([
      makerStates(client, open.map((o) => ({ maker: getAddress(o.maker), nonce: BigInt(o.nonce) }))),
      quoteMany(client, open.map((o) => ({ path: o.path as Hex, amountIn: BigInt(o.amount_in) }))),
      oraclePrices(client, oracleMarkets).catch(() => oracleMarkets.map(() => null)),
    ]);
    const feedBySymbol = new Map<string, OraclePrice>(oracleMarkets.map((m, i) => [m.symbol, feeds[i]]));
    const marketOpen = usMarketOpen();
    const candidates: OpenRow[] = [];
    const updates: D1PreparedStatement[] = [];

    for (let i = 0; i < open.length; i++) {
      const o = open[i], s = states[i], q = quotes[i];
      if (s.nonceUsed) {
        // Spent nonce: filled by someone else, or the maker revoked it.
        const fill = await findFill(o.maker, o.nonce).catch(() => null);
        updates.push(
          fill
            ? db.prepare("UPDATE orders SET status = 'filled', fill_tx = ?2, amount_out = ?3, filled_by = ?4, closed_at = ?5 WHERE id = ?1").bind(o.id, fill.tx, fill.amountOut, fill.filler, started)
            : db.prepare("UPDATE orders SET status = 'cancelled', closed_at = ?2 WHERE id = ?1").bind(o.id, started),
        );
        continue;
      }
      const amountIn = BigInt(o.amount_in);
      const active = isActive(o, feedBySymbol.get(o.symbol) ?? null, marketOpen) ? 1 : 0;
      const note = s.usdg < amountIn ? "unfunded" : s.allowance < amountIn ? "no_allowance" : null;
      updates.push(db.prepare("UPDATE orders SET note = ?2, last_quote = ?3, last_checked_at = ?4, active = ?5 WHERE id = ?1").bind(o.id, note, q?.toString() ?? null, started, active));
      if (active && !note && q != null && q >= BigInt(o.min_amount_out)) candidates.push(o);
    }
    if (updates.length) await db.batch(updates);
    stats.fillable = Math.max(stats.fillable, candidates.length);
    if (!key || candidates.length === 0) return;
    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
    const wallet = createWalletClient({ account, chain: robinhood, transport: transportFor(env.RPC_URL) });
    const balance = await client.getBalance({ address: account.address });
    if (balance < MIN_KEEPER_ETH) {
      stats.error = `keeper gas low: ${balance} wei`;
      return;
    }

    for (const o of candidates.slice(0, MAX_FILLS_PER_RUN)) {
      const args = [
        { maker: getAddress(o.maker), tokenOut: getAddress(o.token_out), minAmountOut: BigInt(o.min_amount_out) },
        { permitted: { token: ADDR.usdg, amount: BigInt(o.amount_in) }, nonce: BigInt(o.nonce), deadline: BigInt(o.deadline) },
        o.signature as Hex,
        o.path as Hex,
      ] as const;
      try {
        // Simulate first: a fill that would revert costs nothing and is retried next minute.
        await client.simulateContract({ account, address: ADDR.stinkbid, abi: STINKBID_ABI, functionName: "fill", args });
        const fees = fillFees((await client.getBlock()).baseFeePerGas);
        const hash = await wallet.writeContract({ address: ADDR.stinkbid, abi: STINKBID_ABI, functionName: "fill", args, ...fees });
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 25_000 });
        if (receipt.status !== "success") throw new Error(`reverted in ${hash}`);
        const log = receipt.logs.find((l) => l.address.toLowerCase() === ADDR.stinkbid.toLowerCase());
        const ev = log ? decodeEventLog({ abi: STINKBID_ABI, data: log.data, topics: log.topics }) : null;
        const amountOut = (ev?.args as { amountOut?: bigint } | undefined)?.amountOut ?? 0n;
        await db.prepare("UPDATE orders SET status = 'filled', fill_tx = ?2, amount_out = ?3, filled_by = ?4, closed_at = ?5, note = NULL WHERE id = ?1")
          .bind(o.id, hash, amountOut.toString(), account.address, now()).run();
        stats.filled++;
      } catch (err) {
        const msg = String((err as { shortMessage?: string })?.shortMessage ?? err).slice(0, 300);
        await db.prepare("UPDATE orders SET note = ?2 WHERE id = ?1").bind(o.id, `fill_failed: ${msg}`).run();
        stats.error = msg;
      }
    }
  } catch (err) {
    stats.error = String((err as { shortMessage?: string })?.shortMessage ?? err).slice(0, 300);
  }
}
