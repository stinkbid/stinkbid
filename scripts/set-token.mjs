#!/usr/bin/env node
// Turns on the $STINKBID holder limits once the token exists. Checks on Robinhood Chain that the address is a
// contract whose symbol() is STINKBID, then writes it to shared/token.ts and /.well-known/stinkbid.json and adds
// the holder-limits table to the docs. Build and deploy afterwards.
//   node scripts/set-token.mjs 0x<address>
import { readFileSync, writeFileSync } from "node:fs";

const addr = process.argv[2] ?? "";
if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error("usage: node scripts/set-token.mjs 0x<40 hex>");
const RPCS = ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.drpc.org"];
async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      last = new Error(JSON.stringify(j.error));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
if ((await rpc("eth_getCode", [addr, "latest"])) === "0x") throw new Error("no contract at that address: nothing written");
const raw = Buffer.from((await rpc("eth_call", [{ to: addr, data: "0x95d89b41" }, "latest"])).slice(2), "hex");
const sym = raw.length >= 96 ? raw.subarray(64, 64 + Number(BigInt("0x" + raw.subarray(32, 64).toString("hex")))).toString() : "";
if (sym !== "STINKBID") throw new Error(`symbol() is ${JSON.stringify(sym)}, not STINKBID: nothing written`);

const t = "shared/token.ts";
writeFileSync(t, readFileSync(t, "utf8").replace(/export const TOKEN: Address \| null = [^;]+;/, `export const TOKEN: Address | null = "${addr}";`));

const cfg = readFileSync("shared/config.ts", "utf8");
const tiers = [...cfg.matchAll(/\{ name: "([^"]+)", minTokens: ([\d_]+), maxUsdg: ([\w._]+), maxOpen: ([\w._]+) \}/g)].map((m) => ({
  name: m[1], minTokens: Number(m[2].replaceAll("_", "")), maxUsdg: m[3] === "LIMITS.maxUsdg" ? 100 : Number(m[3].replaceAll("_", "")), maxOpen: m[4] === "LIMITS.maxOpenPerMaker" ? 10 : Number(m[4].replaceAll("_", "")),
}));

const w = "public/.well-known/stinkbid.json";
const wk = JSON.parse(readFileSync(w, "utf8"));
wk.token = { address: addr, symbol: "STINKBID", role: "Hold $STINKBID to bid bigger: higher size limits and more open bids per wallet, checked from your on-chain balance.", tiers, lookup: "https://stinkbid.pro/api/limits?address=" };
wk.updated = new Date().toISOString().slice(0, 10);
writeFileSync(w, JSON.stringify(wk, null, 2) + "\n");

const d = "_pages/docs.body.html";
const fmt = (n) => n.toLocaleString("en-US");
const rows = tiers.map((x) => `            <tr><th>${x.name}</th><td>${x.minTokens ? `${fmt(x.minTokens)} STINKBID or more` : "Any wallet"}</td><td>Up to ${fmt(x.maxUsdg)} USDG per order, ${x.maxOpen} open bids</td></tr>`).join("\n");
const section = `<h3 id="holder-limits">Holder limits</h3>
          <p>Hold $STINKBID to bid bigger. When you post an order, the API reads your token balance on chain and applies the highest tier it reaches. Check any wallet without signing in at <code>GET /api/limits?address=</code>. Token: <code>${addr}</code>.</p>
          <table>
${rows}
          </table>`;
writeFileSync(d, readFileSync(d, "utf8").replace("<!-- token-tiers -->", section));
console.log(`token ${addr} (STINKBID) set: shared/token.ts, ${w}, docs. Now: npm run deploy, then commit with the bot.`);
