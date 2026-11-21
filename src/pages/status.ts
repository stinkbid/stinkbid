import "./page";
import { get } from "../app/api";
import { explorerAddr } from "./chrome";

type Run = { started_at: number; finished_at: number; mode: string; block: number | null; checked: number; fillable: number; filled: number; error: string | null };
type S = {
  now: number;
  chain: { block: number | null };
  contract: { address: string; deployed: boolean | null };
  keeper: { address: string | null; balanceWei: string | null; lastRun: Run | null; lastHour: { runs: number; errors: number | null; filled: number | null } | null };
  orders: { open: number | null; filled: number | null; filled_24h: number | null } | null;
};

const set = (id: string, html: string) => ((document.getElementById(id) as HTMLElement).innerHTML = html);
const ago = (s: number) => (s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);
const dot = (k: "ok" | "warn" | "bad") => `<span class="dot ${k}"></span>`;
const MODE: Record<string, string> = { live: "Filling", watch: "Watching only", waiting_for_contract: "Waiting for contract" };

async function tick() {
  const r = await get<S>("/api/status");
  if (!r.ok) {
    set("t-updated", "Couldn't reach the status API. Retrying.");
    return;
  }
  const s = r.data;
  const d = s.contract.deployed;
  set("t-contract", `${dot(d ? "ok" : "warn")}${d ? "Deployed" : d === false ? "Not deployed" : "Unknown"}`);
  set("t-contract-s", `<a href="${explorerAddr(s.contract.address)}" target="_blank" rel="noopener">${s.contract.address.slice(0, 10)}…</a>`);

  const run = s.keeper.lastRun;
  const age = run ? s.now - run.finished_at : null;
  const healthy = age !== null && age < 180;
  set("t-keeper", run ? `${dot(healthy ? (run.mode === "live" ? "ok" : "warn") : "bad")}${MODE[run.mode] ?? run.mode}` : `${dot("bad")}No runs yet`);
  set("t-keeper-s", run ? `Last run ${ago(age!)}, checked ${run.checked}, filled ${run.filled}` : "");

  set("t-block", s.chain.block ? s.chain.block.toLocaleString("en-US") : "–");
  set("t-block-s", run?.block ? `Keeper saw ${run.block.toLocaleString("en-US")}` : "");

  if (s.keeper.address && s.keeper.balanceWei) {
    const eth = Number(s.keeper.balanceWei) / 1e18;
    set("t-gas", `${dot(eth > 0.0002 ? "ok" : eth > 0.00005 ? "warn" : "bad")}${eth.toFixed(5)} ETH`);
    set("t-gas-s", `<a href="${explorerAddr(s.keeper.address)}" target="_blank" rel="noopener">${s.keeper.address.slice(0, 10)}…</a>`);
  } else {
    set("t-gas", "–");
    set("t-gas-s", "Keeper wallet not set");
  }

  set("t-open", String(s.orders?.open ?? 0));
  set("t-fills", String(s.orders?.filled_24h ?? 0));
  set("t-fills-s", `${s.orders?.filled ?? 0} all time`);
  set("t-runs", String(s.keeper.lastHour?.runs ?? 0));
  set("t-runs-s", `${s.keeper.lastHour?.errors ?? 0} with an error`);
  set("t-err", run?.error ? `${dot("warn")}Yes` : `${dot("ok")}None`);
  set("t-err-s", run?.error ? run.error.replace(/</g, "&lt;").slice(0, 120) : "on the last run");
  set("t-updated", `Updated ${new Date().toLocaleTimeString("en-GB")}.`);
}

tick();
setInterval(tick, 15_000);
