// Waitlist confirmation email via Resend (resend.com). Fire-and-forget from
// the caller via `ctx.waitUntil`: a failure here must never break the
// waitlist response, so every error is swallowed after being logged.
// Restyle the HTML with the project's own colors/fonts; keep the copy honest.

const BRAND = "STINKBID";
const FROM = `${BRAND} <waitlist@stinkbid.pro>`;
const X_URL = "https://x.com/stinkbid";

function html(): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0b0b0e;font-family:-apple-system,Segoe UI,sans-serif">
<table role="presentation" width="100%" style="background:#0b0b0e;padding:40px 0">
<tr><td align="center">
<table role="presentation" width="480" style="max-width:90%;color:#f4f2fa">
<tr><td style="padding-bottom:28px">
  <span style="font-size:19px;font-weight:600;letter-spacing:-0.5px">${BRAND}</span>
</td></tr>
<tr><td style="padding:28px 0;border-top:1px solid #26222e">
  <h1 style="margin:0 0 16px;font-size:26px;font-weight:600;letter-spacing:-0.5px;color:#fff">You're on the list.</h1>
  <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#c9c3d4">
    One email when we launch &mdash; nothing else. No spam, no hype updates, no third parties.
  </p>
  <p style="margin:0;font-size:15px;line-height:1.6;color:#c9c3d4">
    Build log lives on <a href="${X_URL}" style="color:#d9c8ff">@stinkbid</a>.
  </p>
</td></tr>
<tr><td style="padding:24px 0 0;border-top:1px solid #26222e">
  <p style="margin:0;font-size:12px;line-height:1.6;color:#77708a">
    This is the only email tied to your waitlist signup &mdash; if you didn't request it, you can ignore it.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Sends the "you're on the list" confirmation. Never throws — check the return value if you need to know. */
export async function sendWaitlistConfirmation(apiKey: string, to: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: `You're on the ${BRAND} waitlist`,
        html: html(),
        text: `You're on the list.\n\nOne email when we launch — nothing else. No spam, no hype updates, no third parties.\n\nBuild log: ${X_URL}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ event: "resend_failed", status: res.status, body: (await res.text()).slice(0, 300) }));
    }
    return res.ok;
  } catch (err) {
    console.error(JSON.stringify({ event: "resend_error", err: String(err) }));
    return false;
  }
}
