import "./page";
import { get } from "../app/api";
import { explorerAddr } from "./chrome";

type S = { contract: { deployed: boolean | null }; keeper: { address: string | null } };
const r = await get<S>("/api/status");
const dot = document.getElementById("deploy-dot")!;
const text = document.getElementById("deploy-text")!;
if (r.ok) {
  const d = r.data.contract.deployed;
  dot.className = `dot ${d ? "ok" : "warn"}`;
  text.textContent = d ? "StinkBid is deployed at the address below." : "StinkBid is not deployed yet. The address below is fixed in advance by CREATE2 and cannot belong to any other code.";
  const k = r.data.keeper.address;
  document.getElementById("keeper-addr")!.innerHTML = k ? `<a href="${explorerAddr(k)}" target="_blank" rel="noopener">${k}</a>` : "Not set yet";
} else {
  text.textContent = "Couldn't reach the status API.";
}
