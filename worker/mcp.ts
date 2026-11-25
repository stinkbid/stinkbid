import { Hono } from "hono";
import { encodeFunctionData, getAddress, isAddress, type Address } from "viem";
import {
  ADDR, CHAIN_ID, LIMITS, MARKETS, MAX_USDG_ANY, PERMIT2_ABI, SESSIONS, TRIGGERS, USDG_DECIMALS, marketBySymbol, minOutFor, nonceWord, permitDomain, permitMessage, permitTypes,
} from "../shared/config";
import { makerStates } from "./market";
import { orders } from "./orders";
import { rhClient } from "./rh";
import type { AppEnv } from "./session";

/**
 * Remote MCP server (Streamable HTTP, stateless, JSON responses) at POST /api/mcp.
 * It never holds or asks for a key: `prepare_stink_bid` returns EIP-712 typed data, the agent signs it with
 * its own wallet, and `submit_stink_bid` posts the signature to the same API the app uses.
 */
export const mcp = new Hono<AppEnv>();

const SERVER = { name: "stinkbid", version: "0.1.0" };
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const ERC20_APPROVE = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
const symbols = MARKETS.map((m) => m.symbol);

const TOOLS = [
  {
    name: "list_markets",
    description: "The stock tokens STINKBID supports on Robinhood Chain, with the Uniswap pool price (USDG), the Chainlink price, the gap between them, and the order limits and holder tiers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_quote",
    description: "What a USDG amount buys right now on the pool, with price impact and the Chainlink price.",
    inputSchema: { type: "object", properties: { symbol: { type: "string", enum: symbols }, amount_usdg: { type: "number", minimum: LIMITS.minUsdg, maximum: MAX_USDG_ANY } }, required: ["symbol", "amount_usdg"], additionalProperties: false },
  },
  {
    name: "get_limits",
    description: "A wallet's bid limits (max USDG per bid, max open bids), set by its $STINKBID balance. No signature needed.",
    inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"], additionalProperties: false },
  },
  {
    name: "prepare_stink_bid",
    description:
      "Builds the order(s) for a stink bid: a buy of a stock token that fills only if the price falls `depth_pct` under today's price. Returns EIP-712 typed data to sign with the maker's own wallet (Permit2 witness transfer), one per rung for a ladder, plus the USDG balance and Permit2 approval check. Nothing moves until a fill; the contract reverts if the maker would get less than the signed minimum.",
    inputSchema: {
      type: "object",
      properties: {
        maker: { type: "string", description: "The wallet that signs and receives the stock token." },
        symbol: { type: "string", enum: symbols },
        amount_usdg: { type: "number", minimum: LIMITS.minUsdg, maximum: MAX_USDG_ANY, description: "Total size in USDG (split across rungs for a ladder)." },
        depth_pct: { type: "number", minimum: LIMITS.minDepthBps / 100, maximum: LIMITS.maxDepthBps / 100, description: "How far under today's price, in percent. Ladder rungs sit at depth, 2×depth, …" },
        days: { type: "integer", minimum: 1, maximum: LIMITS.maxDays, default: 7 },
        rungs: { type: "integer", enum: [1, 3, 5], default: 1 },
        fill_on: { type: "string", enum: [...TRIGGERS], default: "pool", description: "pool: fill when the pool pays the price. oracle: also wait for the Chainlink price to reach the level." },
        session: { type: "string", enum: [...SESSIONS], default: "any", description: "closed: only active while the US stock market is closed." },
      },
      required: ["maker", "symbol", "amount_usdg", "depth_pct"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_stink_bid",
    description: "Posts one signed order from prepare_stink_bid. Pass the `order` object it returned and the maker's signature over its typed data.",
    inputSchema: {
      type: "object",
      properties: {
        order: { type: "object", description: "The `order` object from prepare_stink_bid, unchanged." },
        signature: { type: "string", description: "0x… EIP-712 signature by the maker." },
      },
      required: ["order", "signature"],
      additionalProperties: false,
    },
  },
  {
    name: "get_my_bids",
    description: "A wallet's bids (open, filled, cancelled, expired) with fill transactions.",
    inputSchema: { type: "object", properties: { maker: { type: "string" } }, required: ["maker"], additionalProperties: false },
  },
  {
    name: "get_book",
    description: "The public book: open bids per market and recent fills with their transactions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "prepare_cancel",
    description: "Builds the on-chain transaction that cancels a bid: Permit2.invalidateUnorderedNonces for the order's nonce. The maker sends it from their own wallet.",
    inputSchema: { type: "object", properties: { nonce: { type: "string" } }, required: ["nonce"], additionalProperties: false },
  },
];

type Json = Record<string, unknown>;
class ToolError extends Error {}

/** Calls the existing public API in-process, so the MCP tools and the app share one set of checks. */
async function api(env: Env, path: string, init?: RequestInit, ip?: string): Promise<Json> {
  const headers = new Headers(init?.headers);
  if (ip) headers.set("cf-connecting-ip", ip);
  const res = await orders.request(path, { ...init, headers }, env);
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new ToolError(`${String(body.error ?? res.status)}${body.detail ? `: ${String(body.detail)}` : ""}`);
  return body;
}

const randomNonce = () => crypto.getRandomValues(new Uint8Array(8)).reduce((n, x) => (n << 8n) | BigInt(x), 0n) + 1n;
const units = (usdg: number) => BigInt(Math.round(usdg * 10 ** USDG_DECIMALS));
const str = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

async function call(env: Env, name: string, a: Json, ip: string): Promise<Json> {
  switch (name) {
    case "list_markets":
      return api(env, "/markets");
    case "get_quote":
      return api(env, `/quote?symbol=${encodeURIComponent(String(a.symbol))}&amount=${Number(a.amount_usdg)}`);
    case "get_limits":
      return api(env, `/limits?address=${encodeURIComponent(String(a.address))}`);
    case "get_my_bids":
      return api(env, `/orders?maker=${encodeURIComponent(String(a.maker))}`);
    case "get_book":
      return api(env, "/book");
    case "prepare_cancel": {
      const nonce = BigInt(String(a.nonce));
      const { wordPos, bit } = nonceWord(nonce);
      const data = encodeFunctionData({ abi: PERMIT2_ABI, functionName: "invalidateUnorderedNonces", args: [wordPos, 1n << bit] });
      return { chainId: CHAIN_ID, tx: { to: ADDR.permit2, data, value: "0" }, note: "Send from the maker's wallet. After it confirms, that signature no longer works for anyone." };
    }
    case "prepare_stink_bid": {
      if (!isAddress(String(a.maker))) throw new ToolError("invalid_address");
      const maker = getAddress(String(a.maker)) as Address;
      const m = marketBySymbol(String(a.symbol));
      if (!m) throw new ToolError("unknown_market");
      const amount = Number(a.amount_usdg);
      const depth = Number(a.depth_pct);
      const days = Number(a.days ?? 7);
      const n = Number(a.rungs ?? 1);
      if (![1, 3, 5].includes(n)) throw new ToolError("rungs must be 1, 3 or 5");
      if (!(depth >= LIMITS.minDepthBps / 100 && depth <= LIMITS.maxDepthBps / 100)) throw new ToolError("depth_out_of_range");
      if (!(days >= 1 && days <= LIMITS.maxDays)) throw new ToolError("bad_expiry");
      const fillOn = TRIGGERS.includes(a.fill_on as never) ? String(a.fill_on) : "pool";
      const session = SESSIONS.includes(a.session as never) ? String(a.session) : "any";
      const limits = await api(env, `/limits?address=${maker}`);
      const size = units(amount);
      if (amount < LIMITS.minUsdg * n) throw new ToolError(`at least ${LIMITS.minUsdg * n} USDG for ${n} bids`);
      if (amount > Number(limits.maxUsdg) * n) throw new ToolError(`over_tier_limit: ${String(limits.maxUsdg)} USDG per bid for this wallet`);
      const each = size / BigInt(n);
      const rungs = Array.from({ length: n }, (_, i) => ({ amountIn: i === n - 1 ? size - each * BigInt(n - 1) : each, depth: Math.min(depth * (i + 1), LIMITS.maxDepthBps / 100) }));
      if (rungs.some((r) => r.amountIn > units(Number(limits.maxUsdg)))) throw new ToolError(`over_tier_limit: ${String(limits.maxUsdg)} USDG per bid for this wallet`);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 86400);
      const ladder = n > 1 ? [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("") : null;
      const out = [];
      for (const r of rungs) {
        const q = await api(env, `/quote?symbol=${m.symbol}&amount=${Number(r.amountIn) / 10 ** USDG_DECIMALS}`);
        const minAmountOut = minOutFor(BigInt(String(q.amountOut)), Math.round(r.depth * 100));
        const order = { maker, tokenOut: m.token, minAmountOut, amountIn: r.amountIn, nonce: randomNonce(), deadline };
        out.push({
          depth_pct: r.depth,
          fills_at_or_under_usdg: Number(r.amountIn) / 10 ** USDG_DECIMALS / (Number(minAmountOut) / 10 ** m.decimals),
          typedData: str({ domain: permitDomain, types: permitTypes, primaryType: "PermitWitnessTransferFrom", message: permitMessage(order) }),
          order: str({ symbol: m.symbol, maker, amountIn: order.amountIn, minAmountOut, nonce: order.nonce, deadline, fillOn, session, ladder }),
        });
      }
      const [state] = await makerStates(rhClient(env.RPC_URL), [{ maker, nonce: 1n }]).catch(() => [null]);
      const needs = state && state.allowance < size;
      return {
        maker, symbol: m.symbol, total_usdg: amount, rungs: out,
        wallet: state ? { usdg: Number(state.usdg) / 10 ** USDG_DECIMALS, permit2_allowance: Number(state.allowance) / 10 ** USDG_DECIMALS } : null,
        approval_needed: needs
          ? { why: "Permit2 needs a USDG allowance once. This is the only transaction before a fill; it moves no funds.", tx: { to: ADDR.usdg, data: encodeFunctionData({ abi: ERC20_APPROVE, functionName: "approve", args: [ADDR.permit2, size] }), value: "0" } }
          : null,
        next: "Sign each rung's typedData with the maker's wallet (eth_signTypedData_v4), then call submit_stink_bid with that rung's `order` and the signature.",
        tier: { name: limits.tier, max_usdg_per_bid: limits.maxUsdg, max_open: limits.maxOpen },
      };
    }
    case "submit_stink_bid": {
      const o = (a.order ?? {}) as Json;
      return api(env, "/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...o, signature: a.signature }) }, ip);
    }
    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

async function handle(env: Env, msg: Rpc, ip: string): Promise<Json | null> {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // notification
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions:
          "STINKBID: non-custodial stink bids (limit buys under the price) for tokenized stocks on Robinhood Chain. Flow: list_markets → prepare_stink_bid → sign typedData with the maker's own wallet → submit_stink_bid. Never send a private key to this server; it does not need one.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const data = await call(env, name, (msg.params?.arguments ?? {}) as Json, ip);
        return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }], structuredContent: data });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : "internal error";
        if (!(e instanceof ToolError)) console.error(JSON.stringify({ event: "mcp_tool_error", name, err: String(e) }));
        return ok({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${String(msg.method)}`);
  }
}

mcp.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  const msgs: Rpc[] = Array.isArray(body) ? body : [body];
  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const replies = (await Promise.all(msgs.map((m) => handle(c.env, m, ip)))).filter((r): r is Json => r !== null);
  if (!replies.length) return c.body(null, 202);
  return c.json(Array.isArray(body) ? replies : replies[0]);
});

// No server-to-client stream: per the Streamable HTTP spec, GET answers 405.
mcp.get("/", (c) => c.json({ name: SERVER.name, transport: "streamable-http", use: "POST JSON-RPC to this URL", docs: "https://stinkbid.pro/skill.md" }, 405, { Allow: "POST" }));
