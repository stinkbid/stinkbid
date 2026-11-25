import { keeperAddress } from "./keeper";
import { Hono } from "hono";
import { getAddress, isAddress, isHex, recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  ADDR, FEED_DECIMALS, LIMITS, MARKETS, MAX_USDG_ANY, TIERS, SESSIONS, TRIGGERS, depthOf, marketBySymbol, oracleLevelFor, orderId, pathFor, permitDomain, permitMessage, permitTypes,
  usMarketOpen, USDG_DECIMALS, type Session, type Trigger,
} from "../shared/config";
import { isActive, isDeployed, makerStates, marketQuotes, oraclePrices, quoteMany } from "./market";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { rhClient } from "./rh";
import { limitsFor } from "./tiers";
import { TOKEN } from "../shared/token";
import type { AppEnv } from "./session";

export const orders = new Hono<AppEnv>();

const now = () => Math.floor(Date.now() / 1000);
const UINT256_MAX = 2n ** 256n - 1n;

type Row = {
  id: string; maker: string; symbol: string; token_out: string; path: string; amount_in: string; min_amount_out: string;
  nonce: string; deadline: number; signature: string; depth_bps: number; ref_amount_out: string; status: string;
  note: string | null; last_quote: string | null; last_checked_at: number | null; fill_tx: string | null;
  amount_out: string | null; filled_by: string | null; closed_at: number | null; created_at: number;
  fill_on: string; oracle_level: string | null; session: string; ladder: string | null; active: number;
};

/** What a maker sees about their own order. The signature stays out: it is only needed by fillers. */
function publicView(r: Row) {
  const { signature: _s, path: _p, ...rest } = r;
  return rest;
}

orders.get("/markets", async (c) => {
  const client = rhClient(c.env.RPC_URL);
  const [quotes, deployed] = await Promise.all([marketQuotes(client), isDeployed(client).catch(() => false)]);
  c.header("Cache-Control", "public, max-age=15");
  return c.json({ deployed, limits: LIMITS, tiers: TIERS, token: TOKEN, markets: quotes });
});

orders.get("/quote", async (c) => {
  const m = marketBySymbol(c.req.query("symbol") ?? "");
  const amount = Number(c.req.query("amount"));
  if (!m) return c.json({ error: "unknown_market" }, 400);
  if (!(amount >= LIMITS.minUsdg && amount <= MAX_USDG_ANY)) return c.json({ error: "amount_out_of_range" }, 400);
  const amountIn = BigInt(Math.round(amount * 10 ** USDG_DECIMALS));
  const client = rhClient(c.env.RPC_URL);
  // A 1 USDG quote next to the real size shows how far this size alone moves the pool.
  const unit = 10n ** BigInt(USDG_DECIMALS);
  const [[out, small], [feed]] = await Promise.all([
    quoteMany(client, [{ path: pathFor(m), amountIn }, { path: pathFor(m), amountIn: unit }]),
    oraclePrices(client, [m]).catch(() => [null]),
  ]);
  if (out == null) return c.json({ error: "no_quote" }, 502);
  const impactBps = small ? Math.max(0, Math.round((1 - Number((out * 1_000_000n * unit) / (small * amountIn)) / 1_000_000) * 10_000)) : null;
  const price = Number(amountIn) / 10 ** USDG_DECIMALS / (Number(out) / 10 ** m.decimals);
  const oracle = feed ? Number(feed.price) / 10 ** FEED_DECIMALS : null;
  return c.json({
    symbol: m.symbol, amountIn: amountIn.toString(), amountOut: out.toString(), decimals: m.decimals, impactBps,
    oracle, oracleUpdatedAt: feed?.updatedAt ?? null, premiumBps: oracle ? Math.round((price / oracle - 1) * 10_000) : null, marketOpen: usMarketOpen(),
  });
});

orders.post("/orders", async (c) => {
  if (!originAllowed(c)) return c.json({ error: "origin_not_allowed" }, 403);
  const ipHash = await hashIp(clientIp(c), c.env.IP_SALT);
  const rl = await overLimit(c.env.DB, `orders:${ipHash}`, 20, 600);
  if (rl.limited) return c.json({ error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });

  const b = await c.req.json().catch(() => null);
  const m = marketBySymbol(String(b?.symbol ?? ""));
  if (!m) return c.json({ error: "unknown_market" }, 400);
  if (!isAddress(String(b?.maker ?? ""))) return c.json({ error: "invalid_address" }, 400);
  if (!isHex(b?.signature) || b.signature.length < 132 || b.signature.length > 4000) return c.json({ error: "bad_signature" }, 400);

  let amountIn: bigint, minAmountOut: bigint, nonce: bigint, deadline: bigint;
  try {
    amountIn = BigInt(b.amountIn);
    minAmountOut = BigInt(b.minAmountOut);
    nonce = BigInt(b.nonce);
    deadline = BigInt(b.deadline);
  } catch {
    return c.json({ error: "bad_order" }, 400);
  }
  const maker = getAddress(b.maker) as Address;
  const fillOn: Trigger = TRIGGERS.includes(b.fillOn) ? b.fillOn : "pool";
  const session: Session = SESSIONS.includes(b.session) ? b.session : "any";
  const ladder = typeof b.ladder === "string" && /^[0-9a-f]{8,32}$/.test(b.ladder) ? b.ladder : null;
  const unit = 10n ** BigInt(USDG_DECIMALS);
  if (amountIn < BigInt(LIMITS.minUsdg) * unit || amountIn > BigInt(MAX_USDG_ANY) * unit) return c.json({ error: "amount_out_of_range" }, 400);
  if (minAmountOut <= 0n || minAmountOut > UINT256_MAX || nonce < 0n || nonce > UINT256_MAX) return c.json({ error: "bad_order" }, 400);
  if (deadline < BigInt(now() + 600) || deadline > BigInt(now() + LIMITS.maxDays * 86400 + 3600)) return c.json({ error: "bad_expiry" }, 400);

  const order = { maker, tokenOut: m.token, minAmountOut, amountIn, nonce, deadline };
  const signature = b.signature as Hex;
  const typed = { domain: permitDomain, types: permitTypes, primaryType: "PermitWitnessTransferFrom" as const, message: permitMessage(order) };
  const client = rhClient(c.env.RPC_URL);

  const recovered = await recoverTypedDataAddress({ ...typed, signature }).catch(() => null);
  if (recovered !== maker) {
    // Smart-contract wallets sign through ERC-1271; Permit2 accepts those too.
    const ok = await client.verifyTypedData({ address: maker, ...typed, signature }).catch(() => false);
    if (!ok) return c.json({ error: "bad_signature" }, 400);
  }

  // Bigger bids and more open bids come from the wallet's $STINKBID balance, read now (worker/tiers.ts).
  const limits = await limitsFor(client, maker).catch(() => null);
  if (!limits) return c.json({ error: "chain_unavailable" }, 503);
  if (amountIn > BigInt(limits.maxUsdg) * unit) return c.json({ error: "over_tier_limit", detail: String(limits.maxUsdg) }, 400);
  const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE maker = ?1 AND status = 'open'").bind(maker).first<{ n: number }>();
  if ((open?.n ?? 0) >= limits.maxOpen) return c.json({ error: "too_many_open", detail: String(limits.maxOpen) }, 400);

  const [deployed, [quote], [state], [feed]] = await Promise.all([
    isDeployed(client),
    quoteMany(client, [{ path: pathFor(m), amountIn }]),
    makerStates(client, [{ maker, nonce }]),
    oraclePrices(client, [m]),
  ]).catch(() => [null, [null], [null], [null]] as const);
  if (deployed === null || !state) return c.json({ error: "chain_unavailable" }, 503);
  if (!deployed) return c.json({ error: "contract_not_live" }, 409);
  if (quote == null) return c.json({ error: "no_quote" }, 502);
  if (state.nonceUsed) return c.json({ error: "nonce_used" }, 400);
  if (state.usdg < amountIn) return c.json({ error: "not_enough_usdg" }, 400);
  if (state.allowance < amountIn) return c.json({ error: "no_allowance" }, 400);

  const depth = depthOf(quote, minAmountOut);
  if (depth < LIMITS.minDepthBps / 2 || depth > LIMITS.maxDepthBps + 500) return c.json({ error: "depth_out_of_range", detail: String(depth) }, 400);

  if (fillOn === "oracle" && !feed) return c.json({ error: "no_oracle" }, 502);
  const oracleLevel = fillOn === "oracle" ? oracleLevelFor(feed!.price, depth).toString() : null;
  const active = isActive({ fill_on: fillOn, oracle_level: oracleLevel, session }, feed, usMarketOpen()) ? 1 : 0;

  const id = orderId(maker, nonce);
  const res = await c.env.DB.prepare(
    `INSERT INTO orders (id, maker, symbol, token_out, path, amount_in, min_amount_out, nonce, deadline, signature, depth_bps, ref_amount_out, created_at,
                         fill_on, oracle_level, session, ladder, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18) ON CONFLICT (id) DO NOTHING`,
  )
    .bind(id, maker, m.symbol, m.token, pathFor(m), amountIn.toString(), minAmountOut.toString(), nonce.toString(), Number(deadline), signature, depth, quote.toString(), now(),
      fillOn, oracleLevel, session, ladder, active)
    .run();
  if (!res.meta.changes) return c.json({ error: "duplicate" }, 409);
  return c.json({ id, depthBps: depth }, 201);
});

/** A wallet's bid limits from its $STINKBID balance. Public: no wallet connection or signature needed. */
orders.get("/limits", async (c) => {
  const a = c.req.query("address") ?? "";
  if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
  const limits = await limitsFor(rhClient(c.env.RPC_URL), getAddress(a) as Address).catch(() => null);
  if (!limits) return c.json({ error: "chain_unavailable" }, 503);
  c.header("Cache-Control", "public, max-age=30");
  return c.json(limits);
});

orders.get("/orders", async (c) => {
  const maker = c.req.query("maker") ?? "";
  if (!isAddress(maker)) return c.json({ error: "invalid_address" }, 400);
  const { results } = await c.env.DB.prepare("SELECT * FROM orders WHERE maker = ?1 ORDER BY created_at DESC LIMIT 50").bind(getAddress(maker)).all<Row>();
  return c.json({ orders: results.map(publicView) });
});

/** Every open order whose conditions hold right now, with its signature, so anyone can run a filler.
 *  Filling only ever executes the signed terms. Orders waiting on a condition stay unpublished until it holds. */
orders.get("/orders/open", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, maker, symbol, token_out, path, amount_in, min_amount_out, nonce, deadline, signature FROM orders WHERE status = 'open' AND active = 1 AND deadline > ?1 ORDER BY created_at LIMIT 500",
  ).bind(now()).all();
  c.header("Cache-Control", "public, max-age=10");
  return c.json({ contract: ADDR.stinkbid, orders: results });
});

/** The public bid wall. Fills name the maker (the wallet that signed the bid and got the tokens) and the keeper that sent the tx; both are public on chain in the Filled event. */
orders.get("/book", async (c) => {
  const db = c.env.DB;
  const [byMarket, fills, totals] = await Promise.all([
    db.prepare(
      `SELECT symbol, COUNT(*) AS open, SUM(CAST(amount_in AS INTEGER)) AS usdg, MIN(depth_bps) AS shallowest, MAX(depth_bps) AS deepest
       FROM orders WHERE status = 'open' AND deadline > ?1 GROUP BY symbol ORDER BY usdg DESC`,
    ).bind(now()).all(),
    db.prepare(
      "SELECT symbol, maker, amount_in, amount_out, depth_bps, fill_tx, closed_at FROM orders WHERE status = 'filled' ORDER BY closed_at DESC LIMIT 10",
    ).all(),
    db.prepare(
      `SELECT SUM(status = 'open' AND deadline > ?1) AS open, SUM(CASE WHEN status = 'open' AND deadline > ?1 THEN CAST(amount_in AS INTEGER) ELSE 0 END) AS usdg_open,
              SUM(status = 'filled') AS filled, SUM(CASE WHEN status = 'filled' THEN CAST(amount_in AS INTEGER) ELSE 0 END) AS usdg_filled,
              COUNT(DISTINCT CASE WHEN status = 'filled' THEN lower(maker) END) AS makers_filled
       FROM orders`,
    ).bind(now()).first(),
  ]);
  c.header("Cache-Control", "public, max-age=15");
  return c.json({
    totals,
    // token: the stock token contract, so explorers and research sites can key the bid wall by address
    markets: (byMarket.results as { symbol: string }[]).map((m) => ({ ...m, token: MARKETS.find((k) => k.symbol === m.symbol)?.token ?? null })),
    fills: fills.results,
    // Every fill tx is sent by this keeper; the tokens go to the fill's maker.
    filler: keeperAddress(c.env),
    known: MARKETS.map((m) => m.symbol),
    tokens: Object.fromEntries(MARKETS.map((m) => [m.symbol, m.token])),
  });
});
