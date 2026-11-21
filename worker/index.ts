import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth";
import type { AppEnv } from "./session";
import { waitlist } from "./waitlist";
import { orders } from "./orders";
import { status } from "./status";
import { runKeeper } from "./keeper";

const api = new Hono<AppEnv>();

api.use("*", secureHeaders());
api.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

api.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>().catch(() => null);
  return c.json({ ok: db?.ok === 1 }, db ? 200 : 503);
});

api.route("/waitlist", waitlist);
api.route("/auth", auth);
api.route("/", orders);
api.route("/", status);

api.notFound((c) => c.json({ error: "not_found" }, 404));

const app = new Hono<AppEnv>();
app.route("/api", api);

app.onError((err, c) => {
  console.error(JSON.stringify({ event: "unhandled", path: c.req.path, err: err.stack ?? String(err) }));
  return c.req.path.startsWith("/api/") ? c.json({ error: "internal" }, 500) : c.text("Something broke on our side.", 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runKeeper(env));
  },
} satisfies ExportedHandler<Env>;
