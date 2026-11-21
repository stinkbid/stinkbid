// Everything the site, the API and the keeper must agree on. Addresses checked on Robinhood Chain, 21 Nov 2026.
import { encodePacked, type Address, type Hex } from "viem";

export { CHAIN_ID, EXPLORER, RPCS, ADDR } from "./addresses";
import { ADDR, CHAIN_ID } from "./addresses";

export const USDG_DECIMALS = 6;

/** `feed`: the Chainlink "Robinhood <SYM> / USD" feed on Robinhood Chain (8 decimals), checked on-chain 22 Nov 2026. */
export type Market = { symbol: string; name: string; token: Address; decimals: number; fee: number; pool: Address; feed: Address };

/** Stock tokens with the deepest USDG pool on Uniswap v3 (USDG side above ~25k on 21 Nov 2026). One pool each. */
export const MARKETS: Market[] = [
  { symbol: "NVDA", name: "NVIDIA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, fee: 500, pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  { symbol: "TSLA", name: "Tesla", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18, fee: 3000, pool: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  { symbol: "AAPL", name: "Apple", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18, fee: 3000, pool: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  { symbol: "AMZN", name: "Amazon", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18, fee: 3000, pool: "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  { symbol: "MSFT", name: "Microsoft", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18, fee: 3000, pool: "0xeb60bCD1D920ad6E102690CCFC6fB488899E1510", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  { symbol: "GOOGL", name: "Alphabet", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18, fee: 500, pool: "0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" },
  { symbol: "AMD", name: "AMD", token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", decimals: 18, fee: 3000, pool: "0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72" },
  { symbol: "COIN", name: "Coinbase", token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", decimals: 18, fee: 500, pool: "0x3a6eC0aa6C702323414d449B5F60f4B742A82dED", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2" },
  { symbol: "GME", name: "GameStop", token: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", decimals: 18, fee: 10000, pool: "0xE9713f453aDB9245B19559790c96F470a18F2fDF", feed: "0x27C71df6A64fB476468EdF256CF72c038baB5B67" },
  { symbol: "QQQ", name: "Invesco QQQ", token: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", decimals: 18, fee: 500, pool: "0xD60A5d14dB690B7Afad71F76B108071D7175597d", feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae" },
];

export const marketBySymbol = (s: string) => MARKETS.find((m) => m.symbol === s);

/** Beta limits, enforced by the API (the contract itself has none). */
export const LIMITS = {
  minUsdg: 1,
  maxUsdg: 100,
  maxOpenPerMaker: 10,
  maxDays: 30,
  minDepthBps: 100,
  maxDepthBps: 5000,
} as const;

export const pathFor = (m: Market): Hex => encodePacked(["address", "uint24", "address"], [ADDR.usdg, m.fee, m.token]);

/** Tokens the order must receive at least, for a bid `depthBps` under the price implied by `quoteOut`. */
export const minOutFor = (quoteOut: bigint, depthBps: number): bigint => (quoteOut * 10_000n) / BigInt(10_000 - depthBps);

/** How far under the current fill a signed minimum sits, in basis points (negative = above the market). */
export const depthOf = (quoteOut: bigint, minOut: bigint): number =>
  minOut === 0n ? 0 : Math.round(10_000 - Number((quoteOut * 10_000_000n) / minOut) / 1000);

export const orderId = (maker: string, nonce: bigint | string) => `${maker.toLowerCase()}:${BigInt(nonce).toString()}`;

/** EIP-712 data for Permit2's permitWitnessTransferFrom with the StinkBid order as witness. */
export const permitDomain = { name: "Permit2", chainId: CHAIN_ID, verifyingContract: ADDR.permit2 } as const;
export const permitTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Order" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "minAmountOut", type: "uint256" },
  ],
} as const;

export type SignedOrder = {
  maker: Address;
  tokenOut: Address;
  minAmountOut: bigint;
  amountIn: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
};

export const permitMessage = (o: Omit<SignedOrder, "signature">) => ({
  permitted: { token: ADDR.usdg, amount: o.amountIn },
  spender: ADDR.stinkbid,
  nonce: o.nonce,
  deadline: o.deadline,
  witness: { maker: o.maker, tokenOut: o.tokenOut, minAmountOut: o.minAmountOut },
});

export const STINKBID_ABI = [
  {
    type: "function",
    name: "fill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "order", type: "tuple", components: [{ name: "maker", type: "address" }, { name: "tokenOut", type: "address" }, { name: "minAmountOut", type: "uint256" }] },
      {
        name: "permit",
        type: "tuple",
        components: [
          { name: "permitted", type: "tuple", components: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }] },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "path", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "event",
    name: "Filled",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "filler", type: "address", indexed: false },
    ],
  },
] as const;

export const PERMIT2_ABI = [
  { type: "function", name: "nonceBitmap", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "invalidateUnorderedNonces", stateMutability: "nonpayable", inputs: [{ name: "wordPos", type: "uint256" }, { name: "mask", type: "uint256" }], outputs: [] },
] as const;

/** QuoterV2.quoteExactInput is not marked view, but it only reverts internally; declared view so it can be multicalled. */
export const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "view",
    inputs: [{ name: "path", type: "bytes" }, { name: "amountIn", type: "uint256" }],
    outputs: [{ name: "amountOut", type: "uint256" }, { type: "uint160[]" }, { type: "uint32[]" }, { name: "gasEstimate", type: "uint256" }],
  },
] as const;

/** Chainlink AggregatorV3: price with 8 decimals and when it was last updated. */
export const FEED_ABI = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" },
  ] },
] as const;
export const FEED_DECIMALS = 8;

/** When an order may fill. Checked by the keeper and by /api/orders/open; the contract enforces only the signed minimum. */
export const TRIGGERS = ["pool", "oracle"] as const;
export const SESSIONS = ["any", "closed"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export type Session = (typeof SESSIONS)[number];

/** Oracle level for an order: the official price `depthBps` under the price at signing, in feed units (8 decimals). */
export const oracleLevelFor = (feedPrice: bigint, depthBps: number): bigint => (feedPrice * BigInt(10_000 - depthBps)) / 10_000n;

// US equity regular session, 9:30 to 16:00 New York time, Monday to Friday, NYSE holidays and 13:00 early closes.
const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const NYSE_EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

/** True while the US stock market's regular session is open. */
export function usMarketOpen(at: Date = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (NYSE_HOLIDAYS.has(day)) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const close = NYSE_EARLY_CLOSE.has(day) ? 13 * 60 : 16 * 60;
  return minutes >= 9 * 60 + 30 && minutes < close;
}

export const nonceWord = (nonce: bigint) => ({ wordPos: nonce >> 8n, bit: nonce & 0xffn });
