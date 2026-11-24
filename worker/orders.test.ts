import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { LIMITS, MARKETS, USDG_DECIMALS, minOutFor, permitDomain, permitMessage, permitTypes } from "../shared/config";

// Every chain read goes through these mocks, so the tests never touch the network.
const chain = vi.hoisted(() => ({
  verifyTypedData: vi.fn(),
  limitsFor: vi.fn(),
  isDeployed: vi.fn(),
  quoteMany: vi.fn(),
  makerStates: vi.fn(),
  oraclePrices: vi.fn(),
}));

vi.mock("./rh", () => ({ rhClient: () => ({ verifyTypedData: chain.verifyTypedData }) }));
vi.mock("./tiers", () => ({ limitsFor: chain.limitsFor }));
vi.mock("./ratelimit", () => ({ overLimit: async () => ({ limited: false, retryAfter: 0 }) }));
vi.mock("./market", async (importActual) => ({
  ...(await importActual<typeof import("./market")>()),
  isDeployed: chain.isDeployed,
  quoteMany: chain.quoteMany,
  makerStates: chain.makerStates,
  oraclePrices: chain.oraclePrices,
}));

const { orders } = await import("./orders");

// Fresh keys per run, used only to sign test orders.
const maker = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

const market = MARKETS[0];
const unit = 10n ** BigInt(USDG_DECIMALS);
const QUOTE = 1_000_000_000n; // tokens out for the order size at the current pool price
const now = () => Math.floor(Date.now() / 1000);

type Draft = { amountIn: bigint; minAmountOut: bigint; nonce: bigint; deadline: bigint };

function draft(over: Partial<Draft> = {}): Draft {
  return { amountIn: 5n * unit, minAmountOut: minOutFor(QUOTE, 1000), nonce: 7n, deadline: BigInt(now() + 7 * 86400), ...over };
}

async function sign(d: Draft, signer = maker, makerAddr: Address = maker.address): Promise<Hex> {
  return signer.signTypedData({
    domain: permitDomain,
    types: permitTypes,
    primaryType: "PermitWitnessTransferFrom",
    message: permitMessage({ maker: makerAddr, tokenOut: market.token, ...d }),
  });
}

function body(d: Draft, signature: Hex, extra: Record<string, unknown> = {}) {
  return {
    symbol: market.symbol, maker: maker.address, signature,
    amountIn: d.amountIn.toString(), minAmountOut: d.minAmountOut.toString(), nonce: d.nonce.toString(), deadline: d.deadline.toString(),
    ...extra,
  };
}

/** Just enough of D1 for POST /orders: the open-order count and the insert. */
function fakeDb(openCount = 0) {
  const inserts: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => ((args = a), stmt),
        first: async () => ({ n: openCount }),
        run: async () => {
          if (sql.includes("INSERT INTO orders")) inserts.push(args);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { db, inserts };
}

async function post(payload: unknown, openCount = 0) {
  const { db, inserts } = fakeDb(openCount);
  const env = { DB: db, ALLOWED_ORIGINS: "https://stinkbid.pro", IP_SALT: "test" } as unknown as Env;
  const res = await orders.request("/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }, env);
  return { status: res.status, json: (await res.json()) as { error?: string; detail?: string; id?: string; depthBps?: number }, inserts };
}

beforeEach(() => {
  chain.verifyTypedData.mockReset().mockResolvedValue(false);
  chain.limitsFor.mockReset().mockResolvedValue({ maxUsdg: LIMITS.maxUsdg, maxOpen: LIMITS.maxOpenPerMaker });
  chain.isDeployed.mockReset().mockResolvedValue(true);
  chain.quoteMany.mockReset().mockResolvedValue([QUOTE]);
  chain.makerStates.mockReset().mockResolvedValue([{ usdg: 1_000n * unit, allowance: 1_000n * unit, nonceUsed: false }]);
  chain.oraclePrices.mockReset().mockResolvedValue([null]);
});

describe("POST /orders", () => {
  it("accepts a valid signed order and stores it", async () => {
    const d = draft();
    const r = await post(body(d, await sign(d)));
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: `${maker.address.toLowerCase()}:7`, depthBps: 1000 });
    expect(r.inserts).toHaveLength(1);
  });

  describe("signature", () => {
    it("rejects an order signed by another key", async () => {
      const d = draft();
      const r = await post(body(d, await sign(d, stranger)));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_signature" }, inserts: [] });
      expect(chain.verifyTypedData).toHaveBeenCalledOnce();
    });

    it("rejects a signature over different terms", async () => {
      const signed = draft();
      const sent = draft({ minAmountOut: signed.minAmountOut - 1n });
      const r = await post(body(sent, await sign(signed)));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_signature" } });
    });

    it("rejects a value that is not a hex signature", async () => {
      const r = await post(body(draft(), "not-a-signature" as Hex));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_signature" } });
    });

    it("rejects a hex value too short to be a signature", async () => {
      const r = await post(body(draft(), "0x1234"));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_signature" } });
      expect(chain.verifyTypedData).not.toHaveBeenCalled();
    });

    it("accepts a smart-wallet signature that the chain confirms (ERC-1271)", async () => {
      chain.verifyTypedData.mockResolvedValue(true);
      const d = draft();
      const r = await post(body(d, await sign(d, stranger)));
      expect(r.status).toBe(201);
    });
  });

  describe("amount", () => {
    it("rejects less than the minimum", async () => {
      const d = draft({ amountIn: BigInt(LIMITS.minUsdg) * unit - 1n });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "amount_out_of_range" } });
    });

    it("rejects more than the largest tier allows", async () => {
      const d = draft({ amountIn: 2_000n * unit + 1n });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "amount_out_of_range" } });
    });

    it("rejects more than this wallet's tier allows", async () => {
      const d = draft({ amountIn: BigInt(LIMITS.maxUsdg + 1) * unit });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "over_tier_limit", detail: String(LIMITS.maxUsdg) } });
    });

    it("rejects a wallet that already has its maximum of open bids", async () => {
      const d = draft();
      const r = await post(body(d, await sign(d)), LIMITS.maxOpenPerMaker);
      expect(r).toMatchObject({ status: 400, json: { error: "too_many_open" } });
    });

    it("rejects an amount that is not an integer", async () => {
      const d = draft();
      const r = await post({ ...body(d, await sign(d)), amountIn: "1.5" });
      expect(r).toMatchObject({ status: 400, json: { error: "bad_order" } });
    });
  });

  describe("deadline", () => {
    it("rejects a deadline already in the past", async () => {
      const d = draft({ deadline: BigInt(now() - 60) });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_expiry" } });
    });

    it("rejects a deadline less than ten minutes away", async () => {
      const d = draft({ deadline: BigInt(now() + 300) });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_expiry" } });
    });

    it("rejects a deadline past the beta maximum", async () => {
      const d = draft({ deadline: BigInt(now() + (LIMITS.maxDays + 1) * 86400) });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_expiry" } });
    });
  });

  describe("depth under the pool price", () => {
    it.each([
      ["at 1%", 100],
      ["at 50%", 5000],
    ])("accepts a bid %s", async (_label, bps) => {
      const d = draft({ minAmountOut: minOutFor(QUOTE, bps) });
      const r = await post(body(d, await sign(d)));
      expect(r.status).toBe(201);
      expect(r.json.depthBps).toBe(bps);
    });

    it.each([
      ["at the market price", 0],
      ["above the market price", -500],
      ["deeper than 50% plus drift room", 6000],
    ])("rejects a bid %s", async (_label, bps) => {
      const d = draft({ minAmountOut: bps < 0 ? (QUOTE * 9500n) / 10_000n : minOutFor(QUOTE, bps) });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "depth_out_of_range" } });
    });

    it("rejects a zero minimum before any chain read", async () => {
      const d = draft({ minAmountOut: 0n });
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "bad_order" } });
      expect(chain.quoteMany).not.toHaveBeenCalled();
    });
  });

  describe("wallet state", () => {
    it("rejects a nonce Permit2 has already used", async () => {
      chain.makerStates.mockResolvedValue([{ usdg: 1_000n * unit, allowance: 1_000n * unit, nonceUsed: true }]);
      const d = draft();
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "nonce_used" } });
    });

    it("rejects a wallet without enough USDG", async () => {
      chain.makerStates.mockResolvedValue([{ usdg: unit, allowance: 1_000n * unit, nonceUsed: false }]);
      const d = draft();
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "not_enough_usdg" } });
    });

    it("rejects a wallet whose Permit2 allowance is too small", async () => {
      chain.makerStates.mockResolvedValue([{ usdg: 1_000n * unit, allowance: unit, nonceUsed: false }]);
      const d = draft();
      const r = await post(body(d, await sign(d)));
      expect(r).toMatchObject({ status: 400, json: { error: "no_allowance" } });
    });
  });

  it("rejects an unknown market", async () => {
    const d = draft();
    const r = await post({ ...body(d, await sign(d)), symbol: "NOPE" });
    expect(r).toMatchObject({ status: 400, json: { error: "unknown_market" } });
  });
});
