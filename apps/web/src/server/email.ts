import "server-only";
import { env } from "./env";

const printEmail = (to: string, subject: string, text: string) =>
  console.log(`\n[email:dev] To: ${to}\n[email:dev] Subject: ${subject}\n[email:dev] ${text}\n`);

/**
 * Transactional email via Resend's REST API. Without RESEND_API_KEY (local development) the message is printed to the
 * server console instead, so verification and reset links still work.
 *
 * In development a rejected send is printed too instead of throwing: Resend's test sender (onboarding@resend.dev) only
 * delivers to the Resend account owner, and Better Auth sends the verification email inside the sign-up transaction,
 * so a throw here would roll the new account back and fail sign-up with a 500.
 */
export async function sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const key = env.email.resendKey;
  if (!key) {
    printEmail(to, subject, text);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.email.from, to, subject, html, text }),
  });
  if (res.ok) return;
  const detail = `Email send failed (${res.status}): ${await res.text()}`;
  if (process.env.NODE_ENV === "production") throw new Error(detail);
  console.warn(`[email:dev] ${detail}\n[email:dev] Printing the email here instead (see docs/setup/AUTH_EMAIL_SETUP.md).`);
  printEmail(to, subject, text);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Simple dark email matching the product look. */
export function actionEmail(heading: string, body: string, buttonLabel: string, url: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#030407;font-family:Arial,sans-serif;color:#F3F5F9">
<div style="max-width:520px;margin:0 auto;padding:40px 28px">
<p style="font-family:monospace;color:#7C8494;margin:0 0 8px">// videozilla</p>
<h1 style="font-size:26px;margin:0 0 16px">${escapeHtml(heading)}</h1>
<p style="color:#C9CED8;line-height:1.6;margin:0 0 28px">${escapeHtml(body)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#38D9F5;color:#030407;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${escapeHtml(buttonLabel)}</a>
<p style="color:#7C8494;font-size:12px;margin-top:28px">If you didn't ask for this, you can ignore this email.</p>
</div></body></html>`;
  return { html, text: `${heading}\n\n${body}\n\n${buttonLabel}: ${url}` };
}
