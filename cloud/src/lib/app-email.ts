/** The two emails the app sends: the invite, and a password reset.
 *
 * Same Resend account as the ai-invoice dashboard (from `RESEND_FROM`), same
 * dark-card look the creator setup email already uses — deliberately: the
 * invite has to feel like it came from the same company that invited her
 * before. Raw fetch, like lib/editors.ts, because the whole call is one POST.
 *
 * Email is a convenience here, never the handoff itself: when Resend is not
 * configured the console still shows the join URL to copy, exactly as the
 * editor notification does.
 */

const RESEND_URL = 'https://api.resend.com/emails'

export function appEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM)
}

/** Links inside emails must point at the canonical deployment — the default
 *  is hardcoded so a missing APP_URL can never leak a proxied request host
 *  into an email (2026-10-13). APP_URL still overrides for local dev. */
export function appOrigin(_request: Request): string {
  return (process.env.APP_URL || 'https://plan.gosianmedia.com').replace(/\/+$/, '')
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function send({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<{ sent: boolean; why?: string }> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!key || !from) {
    return { sent: false, why: 'Email is not set up (RESEND_API_KEY / RESEND_FROM) — copy them the link instead.' }
  }
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  }).catch(() => null)
  if (!response?.ok) {
    return { sent: false, why: `The email bounced off Resend${response ? ` (${response.status})` : ''} — copy them the link instead.` }
  }
  return { sent: true }
}

/** Shared shell: ink ground, one orange top edge, the wordmark. */
function shell(origin: string, inner: string): string {
  const logo = `${origin}/gosian-logo.png`
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#171717;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1e1e1e;border:1px solid #2c2c2c;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="height:3px;background-color:#f25623;background-image:linear-gradient(90deg,#ed6d3a,#f25623,#faaa8b);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" style="padding:30px 32px 0;">
              <img src="${escapeHtml(logo)}" alt="Gosian Media" width="132" style="display:block;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          ${inner}
        </table>
        <p style="margin:18px 0 0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5c5c5c;">Gosian Media</p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}

/** Her invite: set the password, and the app opens on her week. */
export async function sendModelInviteEmail({
  to,
  name,
  setupUrl,
  origin,
  expiresInDays = 7,
}: {
  to: string
  name?: string | null
  setupUrl: string
  origin: string
  expiresInDays?: number
}): Promise<{ sent: boolean; why?: string }> {
  const displayName = String(name ?? '').trim() || to.split('@')[0]
  const inner = `
          <tr>
            <td style="padding:22px 32px 0;text-align:center;">
              <h1 style="margin:0;font-size:23px;line-height:1.3;font-weight:700;letter-spacing:-0.02em;color:#fafafa;">
                Your studio is ready, ${escapeHtml(displayName)}
              </h1>
              <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                Your week is built, the references are up, and the team is on the other end.
                Set your password and it all opens on your phone.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 32px 0;">
              <a href="${escapeHtml(setupUrl)}" style="display:inline-block;background-color:#f25623;background-image:linear-gradient(135deg,#faaa8b,#ed6d3a);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 34px;border-radius:12px;">
                Set my password
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#191919;border:1px solid #2a2a2a;border-radius:12px;">
                <tr><td style="padding:16px 18px 4px;"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#767676;">Two things to know</p></td></tr>
                <tr>
                  <td style="padding:0 18px 10px;">
                    <p style="margin:8px 0 0;font-size:13px;line-height:1.55;color:#a3a3a3;">
                      <strong style="color:#ececef;">Your email is</strong> ${escapeHtml(to)} — that is your sign-in, with the password you are about to set.
                    </p>
                    <p style="margin:10px 0 0;font-size:13px;line-height:1.55;color:#a3a3a3;border-top:1px solid #2a2a2a;padding-top:10px;">
                      <strong style="color:#ececef;">This link is yours alone</strong> — it expires in ${Number(expiresInDays) || 7} days and stops working the moment you set your password.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 30px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#767676;">
                Button not working?<br />
                <a href="${escapeHtml(setupUrl)}" style="color:#ff7a3d;word-break:break-all;text-decoration:none;">${escapeHtml(setupUrl)}</a>
              </p>
              <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#767676;">
                If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>`
  return send({
    to,
    subject: 'Your Gosian studio is ready',
    html: shell(origin, inner),
    text: `Your studio is ready, ${displayName}.\n\nYour week is built, the references are up, and the team is on the other end. Set your password and it all opens on your phone.\n\nSet your password: ${setupUrl}\n\nYour email is ${to} — that is your sign-in. This link expires in ${Number(expiresInDays) || 7} days and stops working the moment you set your password.\n\n— Gosian Media`,
  })
}

/** A new password, into the same page as the invite. */
export async function sendModelResetEmail({
  to,
  name,
  resetUrl,
  origin,
}: {
  to: string
  name?: string | null
  resetUrl: string
  origin: string
}): Promise<{ sent: boolean; why?: string }> {
  const displayName = String(name ?? '').trim() || to.split('@')[0]
  const inner = `
          <tr>
            <td style="padding:22px 32px 0;">
              <h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:600;color:#fafafa;">Reset your password</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#a3a3a3;">
                Hi ${escapeHtml(displayName)}, here is a fresh link to set a new password for the Gosian app.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 32px 0;">
              <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background-color:#f25623;background-image:linear-gradient(135deg,#f25623,#d9491b);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 30px;border-radius:11px;">
                Set a new password
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 30px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#767676;">
                Or copy this link:<br />
                <a href="${escapeHtml(resetUrl)}" style="color:#ff7a3d;word-break:break-all;">${escapeHtml(resetUrl)}</a>
              </p>
              <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#767676;">
                This link expires in 1 hour. If you didn't ask for it, you can ignore this email — nothing changes until the link is used.
              </p>
            </td>
          </tr>`
  return send({
    to,
    subject: 'Reset your Gosian password',
    html: shell(origin, inner),
    text: `Reset your password\n\nHi ${displayName}, here is a fresh link to set a new password for the Gosian app:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't ask for it, you can ignore this email — nothing changes until the link is used.\n\n— Gosian Media`,
  })
}
