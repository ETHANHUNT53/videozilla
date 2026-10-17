# Videozilla — UI reference (Google Stitch)

The approved web-app look recreated in Google Stitch as a storyboard, plus the remaining V1 screens from the PRD (§10 screen inventory) designed in the same style.

- **Stitch project:** "Videozilla — UI reference" (`projects/16508777293084399345`)
- **Design system:** "Videozilla Midnight" (`assets/13763739402437643849`) — dark-only, background `#030407`, cyan `#38D9F5` primary, violet / orange / green / red accents by meaning, Geist + Geist Mono, `// eyebrow` labels, glowing chips.
- **Prompts used:** [STITCH_PROMPTS.md](STITCH_PROMPTS.md)
- **Local screenshots:** [stitch/](stitch/) (backup copies of the screens that could be downloaded)

## Screens

| # | Screen | PRD | Status | Local copy |
|---|---|---|---|---|
| 01 | Landing | — | ✅ recreated from the app | [01-landing.png](stitch/01-landing.png) |
| 02 | Sign in | S1 | ✅ recreated | [02-sign-in.png](stitch/02-sign-in.png) |
| 03 | Create account | S1 | ✅ recreated (on the canvas twice; keep either) | [03-create-account.png](stitch/03-create-account.png) |
| 04 | Check your email | S1 | ✅ recreated | [04-check-email.png](stitch/04-check-email.png) |
| 05 | Library — empty | S3 | ✅ recreated | [05-library-empty.png](stitch/05-library-empty.png) |
| 06 | Library (with videos, menu, undo toast) | S3 | ✅ recreated (on the canvas twice; keep the taller one) | [06-library.png](stitch/06-library.png) |
| 07 | Project — Idea step | S4 | ✅ recreated (Stitch added a prompt box and quick starters) | [07-project-idea.png](stitch/07-project-idea.png) |
| 08 | Settings | S9 | ✅ recreated, with "Connect Instagram" button | [08-settings.png](stitch/08-settings.png) |
| 09 | Idea Studio (find a topic, 5 ideas, brief, idea chat, settings) | S4 / F2 | ✅ new — on the canvas | — |
| 10 | Storyboard Review (scene cards, revision chat, caption) | S5 / F3, F7 | ✅ new — on the canvas | — |
| 11 | Building video (step progress) | S6 / F10 | ✅ new — on the canvas | — |
| 12 | Video Preview (9:16 player, scenes, export) | S7 / F8 | ✅ new — on the canvas | — |
| 13 | Publish dialog (caption, post now / schedule) | S8 / F9 | ✅ new — on the canvas | — |
| 14 | Posted (success + failed state) | F9 | ✅ new — on the canvas | — |
| 15 | Connect Instagram (eligibility modal) | F9 | ✅ new — on the canvas | — |
| 16 | Welcome (onboarding) | S2 | ✅ new — on the canvas; built in F1.12 | [16-welcome.png](stitch/16-welcome.png) |
| 17 | Notifications panel | S10 | ✅ new — on the canvas | — |
| 18 | Forgot password (+ link-sent state) | S1 | ✅ new | [18-forgot-password.png](stitch/18-forgot-password.png) |

All 18 screens are confirmed on the Stitch canvas (2026-10-16). Screens 09–17 have no local copy because their generation timed out on my side before Stitch returned them.

## Notes

- The real app (`apps/web`) remains the source of truth for the screens that already exist (01–08). For screens 09–18, the Stitch designs are the reference to build from in M2–M6.
- Not yet designed: reset-password form, admin view (M7), mobile layouts.
