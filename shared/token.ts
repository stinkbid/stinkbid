import type { Address } from "viem";

/**
 * The $STINKBID token on Robinhood Chain. null until it exists: then every wallet has the base limits.
 * Set once, at launch, together with public/.well-known/stinkbid.json, and checked on chain (contract code + symbol).
 */
export const TOKEN: Address | null = "0x5b2c126f4522839110b2ce9d92ff454b26bdc562";
export const TOKEN_SYMBOL = "STINKBID";
export const TOKEN_DECIMALS = 18;
