import { describe, expect, it } from "vitest";
import { fillFees } from "./keeper";

const GWEI = 1_000_000_000n;

describe("fillFees", () => {
  it("pays twice the base fee plus 1000 wei", () => {
    expect(fillFees(20_000_000n)).toEqual({ maxFeePerGas: 40_001_000n, maxPriorityFeePerGas: 1_000n });
  });

  it("keeps the tip at 1000 wei whatever the base fee", () => {
    expect(fillFees(1n).maxPriorityFeePerGas).toBe(1_000n);
    expect(fillFees(400_000_000n).maxPriorityFeePerGas).toBe(1_000n);
  });

  it("treats a missing base fee as zero", () => {
    expect(fillFees(undefined)).toEqual({ maxFeePerGas: 1_000n, maxPriorityFeePerGas: 1_000n });
    expect(fillFees(null)).toEqual({ maxFeePerGas: 1_000n, maxPriorityFeePerGas: 1_000n });
    expect(fillFees(0n).maxFeePerGas).toBe(1_000n);
  });

  it("allows a max fee of exactly 1 gwei", () => {
    const base = (GWEI - 1_000n) / 2n; // 499_999_500 wei
    expect(fillFees(base).maxFeePerGas).toBe(GWEI);
  });

  it("refuses anything above 1 gwei", () => {
    const base = (GWEI - 1_000n) / 2n + 1n; // max fee 1 gwei + 2 wei
    expect(() => fillFees(base)).toThrow(`gas too high: ${GWEI + 2n}`);
    expect(() => fillFees(GWEI)).toThrow(/gas too high/);
  });
});
