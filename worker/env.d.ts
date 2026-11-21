interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Comma-separated origins allowed to call state-changing endpoints. */
  ALLOWED_ORIGINS: string;
  /** Optional dedicated RPC (e.g. Alchemy). Secret: it contains an API key. */
  RPC_URL?: string;
  /** Secrets — set with `wrangler secret put`, locally in .dev.vars. */
  TURNSTILE_SECRET: string;
  IP_SALT: string;
  /** Keeper wallet key (secret). Without it the keeper runs in watch mode and sends nothing. */
  KEEPER_KEY?: string;
  /** Keeper passes per cron minute (1 to 5); the end-to-end test sets 1. */
  KEEPER_PASSES?: string;
  /** Optional: waitlist confirmation emails are skipped (not failed) when unset. */
  RESEND_API_KEY?: string;
}
