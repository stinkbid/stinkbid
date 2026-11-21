import { Hono } from "hono";
import { ADDR, EXPLORER } from "../shared/config";
import { keeperAddress } from "./keeper";
import { isDeployed } from "./market";
import { rhClient } from "./rh";
import type { AppEnv } from "./session";

export const status = new Hono<AppEnv>();

/** What the keeper and the contract are doing right now, from the keeper's own run log and the chain. */
status.get("/status", async (c) => {
  const db = c.env.DB;
  const client = rhClient(c.env.RPC_URL);
  const keeper = keeperAddress(c.env);
  const t = Math.floor(Date.now() / 1000);
  const [deployed, block, balance, last, hour, orders] = await Promise.all([
    isDeployed(client).catch(() => null),
    client.getBlockNumber().then(Number).catch(() => null),
    keeper ? client.getBalance({ address: keeper }).then(String).catch(() => null) : Promise.resolve(null),
    db.prepare("SELECT * FROM keeper_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1").first(),
    db.prepare(
      "SELECT COUNT(*) AS runs, SUM(error IS NOT NULL) AS errors, SUM(filled) AS filled, MAX(finished_at - started_at) AS slowest FROM keeper_runs WHERE started_at > ?1",
    ).bind(t - 3600).first(),
    db.prepare(
      "SELECT SUM(status = 'open' AND deadline > ?1) AS open, SUM(status = 'filled') AS filled, SUM(status = 'filled' AND closed_at > ?2) AS filled_24h FROM orders",
    ).bind(t, t - 86400).first(),
  ]);
  c.header("Cache-Control", "public, max-age=10");
  return c.json({
    now: t,
    chain: { id: 4663, block, explorer: EXPLORER },
    contract: { address: ADDR.stinkbid, deployed },
    keeper: { address: keeper, balanceWei: balance, lastRun: last, lastHour: hour },
    orders,
  });
});
