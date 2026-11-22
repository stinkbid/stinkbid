export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; detail?: string };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, error: json.error ?? "unknown", detail: json.detail };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => call<T>("POST", path, body);

/** Human copy for every error code the API can return. Add one line per new code. */
export const ERRORS: Record<string, string> = {
  network: "Couldn't reach STINKBID. Check your connection and try again.",
  internal: "Something broke on our side. Try again.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  not_signed_in: "Your session ended. Sign in with your wallet again.",
  origin_not_allowed: "This action only works on stinkbid.pro.",
  invalid_address: "That isn't a valid address (0x + 40 hex characters).",
  chain_unavailable: "The chain didn't answer in time. Try again in a moment.",
  message_rejected: "The sign-in message didn't match this site. Try again.",
  nonce_expired: "The sign-in request expired. Try again.",
  bad_signature: "The signature didn't match your wallet. Try again.",
  user_rejected: "You cancelled the request in your wallet.",
  wallet_error: "Your wallet returned an error. Unlock it and try again.",
  no_account: "Your wallet didn't share an account. Unlock it and try again.",
  unknown_market: "That stock isn't listed.",
  amount_out_of_range: "That size is outside the limits. Check the size and try again.",
  over_tier_limit: "That size is over this wallet's limit. The limit shown under Size comes from your $STINKBID balance.",
  bad_order: "The order didn't look right. Reload the page and try again.",
  bad_expiry: "Pick an expiry between 1 and 30 days.",
  too_many_open: "This wallet has reached its open-bid limit. Cancel one first.",
  contract_not_live: "The contract isn't deployed yet.",
  no_quote: "The pool didn't return a price. Try again in a moment.",
  no_oracle: "The official price feed didn't answer. Try again, or fill on the pool price.",
  nonce_used: "That order was already used. Sign a new one.",
  not_enough_usdg: "Not enough USDG in this wallet for that size.",
  no_allowance: "The Permit2 approval is lower than this order. Press the button again to approve the full amount.",
  depth_out_of_range: "The price moved while you signed. Sign again.",
  duplicate: "That order is already placed.",
  approve_failed: "The approval transaction failed. Nothing was signed.",
  approval_too_low: "Your wallet approved less USDG than this order needs. Press the button again and keep the amount your wallet suggests.",
  no_wallet: "No browser wallet found. Install Rabby or MetaMask, or open this page in your wallet app's browser.",
};

export const errorText = (code: string) => ERRORS[code] ?? ERRORS.internal;
