import { describe, expect, it } from "vitest";
import { ADDR, MARKETS, depthOf, marketBySymbol, minOutFor, nonceWord, orderId, pathFor } from "./config";

describe("minOutFor", () => {
  it("returns the quote unchanged at zero depth", () => {
    expect(minOutFor(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("asks for more tokens the deeper the bid", () => {
    // 10% under the market: 1000 / 0.9, rounded down.
    expect(minOutFor(1000n, 1000)).toBe(1111n);
    // 50% under the market: twice the tokens.
    expect(minOutFor(10n ** 18n, 5000)).toBe(2n * 10n ** 18n);
  });

  it("rounds down, never up", () => {
    expect(minOutFor(1n, 100)).toBe(1n);
    expect(minOutFor(99n, 100)).toBe(100n);
  });
});

describe("depthOf", () => {
  it("is zero when the minimum is zero", () => {
    expect(depthOf(1000n, 0n)).toBe(0);
  });

  it("is zero when the minimum equals the quote", () => {
    expect(depthOf(10n ** 18n, 10n ** 18n)).toBe(0);
  });

  it("inverts minOutFor at token scale for every depth the API allows", () => {
    const quote = 3n * 10n ** 17n;
    for (let bps = 100; bps <= 5000; bps += 50) expect(depthOf(quote, minOutFor(quote, bps))).toBe(bps);
  });

  it("is negative when the minimum sits above the market", () => {
    expect(depthOf(1000n, 900n)).toBe(-1111);
  });
});

describe("pathFor", () => {
  it("packs USDG, the pool fee and the stock token (20 + 3 + 20 bytes)", () => {
    const nvda = marketBySymbol("NVDA")!;
    const path = pathFor(nvda);
    expect(path.length).toBe(2 + 2 * 43);
    expect(path.toLowerCase()).toBe(`0x${ADDR.usdg.slice(2)}0001f4${nvda.token.slice(2)}`.toLowerCase());
  });

  it("encodes each market's own fee tier", () => {
    for (const m of MARKETS) {
      const fee = parseInt(pathFor(m).slice(2 + 40, 2 + 46), 16);
      expect(fee).toBe(m.fee);
    }
  });
});

describe("nonceWord", () => {
  it("splits a nonce into Permit2's word position and bit", () => {
    expect(nonceWord(0n)).toEqual({ wordPos: 0n, bit: 0n });
    expect(nonceWord(255n)).toEqual({ wordPos: 0n, bit: 255n });
    expect(nonceWord(256n)).toEqual({ wordPos: 1n, bit: 0n });
    expect(nonceWord((7n << 8n) | 42n)).toEqual({ wordPos: 7n, bit: 42n });
  });

  it("handles nonces near the top of uint256", () => {
    const n = 2n ** 256n - 1n;
    expect(nonceWord(n)).toEqual({ wordPos: 2n ** 248n - 1n, bit: 255n });
  });
});

describe("orderId", () => {
  const maker = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

  it("lowercases the maker and prints the nonce in decimal", () => {
    expect(orderId(maker, 5n)).toBe(`${maker.toLowerCase()}:5`);
  });

  it("gives the same id for a bigint, a decimal string and a hex string", () => {
    const id = orderId(maker, 256n);
    expect(orderId(maker, "256")).toBe(id);
    expect(orderId(maker.toUpperCase().replace("0X", "0x"), "0x100")).toBe(id);
  });

  it("rejects a nonce that is not a number", () => {
    expect(() => orderId(maker, "abc")).toThrow();
  });
});
