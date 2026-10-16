/**
 * Sends one test email with the same settings the app uses, so email setup can be checked without signing up.
 *   npm run email:test -- you@example.com
 */
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env.local — rely on the environment
  }
}

async function main() {
  loadEnvLocal();
  const to = process.argv[2];
  if (!to) throw new Error("Usage: npm run email:test -- you@example.com");
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is empty in apps/web/.env.local — emails are only printed in the dev terminal.");
  const from = process.env.EMAIL_FROM || "Videozilla <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "Videozilla test email",
      text: "If you can read this, Videozilla email sending works.",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Resend rejected the email (${res.status}): ${body}`);
    if (res.status === 403 || /testing emails|verify a domain/i.test(body)) {
      console.error("Tip: with the onboarding@resend.dev sender you can only email the address you signed up to Resend with. Verify a domain to email anyone.");
    }
    process.exit(1);
  }
  console.log(`Sent from "${from}" to ${to}. Resend id: ${JSON.parse(body).id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
