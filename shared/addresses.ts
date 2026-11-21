// Plain constants with no imports, so light pages can use them without loading viem.
export const CHAIN_ID = 4663;
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const RPCS = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
];

export const ADDR = {
  /** CREATE2 address from contracts/script/Deploy.s.sol (salt keccak256("stinkbid.v1")). */
  stinkbid: "0x362917b506695C2096e361Fc032D4315f2439760",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  router: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  create2Deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
} as const;

