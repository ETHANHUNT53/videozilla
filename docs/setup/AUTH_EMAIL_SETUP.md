# Setup guide — Sign-in, email and Google (features F1.1–F1.4)

**Where things stand:** Better Auth is already set up in code (`apps/web/src/server/auth.ts`), and a secret was generated in `apps/web/.env.local`. Emails "don't send" because `RESEND_API_KEY` is empty. In that case the app is in development mode and **prints each email (with its link) in the terminal running `npm run dev`**.

You need three things: (A) run the app locally, (B) real email via Resend, (C) optional Google sign-in.

> All keys go into **`apps/web/.env.local`**. Open it in Notepad or VS Code. Never paste keys into chat and never commit this file (it's git-ignored).

---

## A. Run the app locally (2 terminals)

1. Open PowerShell in `C:\Users\Shaurya\Desktop\Ai Video generator\apps\web`.
2. Terminal 1, the database (keep it open):
   ```
   npm run db
   ```
   Wait for `Local MongoDB ready`.
3. Terminal 2, the web app (keep it open):
   ```
   npm run dev
   ```
4. Open http://localhost:3000.

**Without Resend:** sign up, then look at terminal 2. You'll see `[email:dev] … Verify email: http://localhost:3000/api/auth/verify-email?token=…`. Open that link to verify. This already works today.

---

## B. Real email with Resend (about 5 minutes)

1. Go to **https://resend.com** → **Sign up** (use the email you want test mails to arrive at).
2. In the Resend dashboard: **API Keys** → **Create API Key** → name `videozilla-dev`, permission **Sending access** → **Add** → copy the key (starts with `re_`). It's shown only once.
3. In `apps/web/.env.local` set:
   ```
   RESEND_API_KEY=re_your_key_here
   EMAIL_FROM=Videozilla <onboarding@resend.dev>
   ```
4. Stop `npm run dev` (Ctrl+C) and start it again, so it reads the new key.
5. Test sending (use the **same email you signed up to Resend with**):
   ```
   npm run email:test -- your-resend-signup-email@gmail.com
   ```
   You should see `Sent from … Resend id: …` and get the mail (check Spam the first time).
6. Now sign up in the app with that email. The verification email arrives in your inbox.

### Important limit (testing sender)

With `onboarding@resend.dev`, Resend only delivers to **your own Resend account email**. Any other address is rejected by Resend (`403`, or `422` for test domains like `example.com`). In local development the app then prints that email, with its link, in the `npm run dev` terminal instead, so sign-up still works. (In production a rejected email is an error.) To email anyone, add your domain:

1. Resend → **Domains** → **Add Domain** → enter e.g. `mail.videozilla.in` (once you've bought the domain).
2. Resend shows 3–4 DNS records (TXT for SPF/DKIM, MX). Add them at your domain registrar's DNS page.
3. Click **Verify** (it can take minutes to a few hours).
4. Change `.env.local`: `EMAIL_FROM=Videozilla <noreply@mail.videozilla.in>` → restart `npm run dev`.

---

## C. Google sign-in (optional, about 10 minutes)

1. Go to **https://console.cloud.google.com** → top bar project picker → **New Project** → name `Videozilla` → Create, then select it.
2. **APIs & Services → OAuth consent screen** (or "Google Auth Platform → Branding"):
   - User type **External** → app name `Videozilla`, support email = yours, developer email = yours → Save.
   - **Audience / Test users:** add your Gmail address (while the app is in "Testing", only test users can sign in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name `Videozilla local`.
   - **Authorized JavaScript origins:** `http://localhost:3000`
   - **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google`
   - Create → copy the **Client ID** and **Client secret**.
4. In `apps/web/.env.local` set:
   ```
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-....
   ```
5. Restart `npm run dev`. The **Continue with Google** button now appears on Sign in and Create account.

---

## D. Checklist to mark F1.1–F1.4 done

| Test | Expected |
|---|---|
| Sign up with email | "Check your email" screen; email arrives (or link in terminal) |
| Click the verification link | Signed in, lands on Library |
| Sign out → sign in | Back in Library |
| Wrong password | Error message, no sign-in |
| Forgot password → email → new password | Can sign in with the new password; old sessions signed out |
| Continue with Google | Signed in; same account if the Gmail matches an email account |

Tell me when A–C are done (or which part fails, with the error text — not the keys) and I'll run through the checklist with you.

## Troubleshooting

| Problem | Fix |
|---|---|
| `email:test` says `RESEND_API_KEY is empty` | Key not saved in `apps/web/.env.local`, or the file has a different name |
| Resend `403 … testing emails` | You're sending to an address other than your Resend signup email — verify a domain (B) |
| Resend `401` | Wrong or deleted key — create a new one |
| No email but no error | Check Spam; check Resend dashboard → **Emails** for the delivery status |
| Google `redirect_uri_mismatch` | The redirect URI must be exactly `http://localhost:3000/api/auth/callback/google` |
| Google "access blocked / app not verified" | Add your Gmail as a **test user** on the consent screen |
| Google button missing | Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be set, then restart `npm run dev` |
| `Missing environment variable MONGODB_URI` | Run from `apps/web`, and keep `npm run db` running |
| "Couldn't create your account" / "Something went wrong on our side", and sign-in fails too | The database isn't running: start `npm run db`. If it was down while `npm run dev` was running, restart `npm run dev` too |
| `[email:dev] Email send failed (403/422)` in the dev terminal | Expected with the Resend testing sender for addresses other than yours — use the printed link below it |
