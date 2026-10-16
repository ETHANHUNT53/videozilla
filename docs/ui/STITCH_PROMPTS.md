# Videozilla — Google Stitch prompts (reference UI)

These prompts recreate the current Videozilla web UI (the M1 draft in `apps/web`) in Google Stitch, as a visual reference board. Paste the **Design system** block first (or include it at the top of each screen prompt), then one screen prompt at a time. Use **Web** mode, desktop width 1440.

---

## 1. Design system (paste first)

```
Design system for "videozilla", a dark AI explainer-video SaaS. Match this exactly:

THEME: dark only. Page background #030407 (near black). Raised surfaces #0A0D14. Cards: white at 3.5% opacity (rgba(255,255,255,0.035)) with a 1px border of white at 9% opacity, corner radius 16px. Hover surface white 6%.
TEXT: primary #F3F5F9, muted #8A92A3, dim #5B6372.
ACCENTS (use meaningfully): cyan #38D9F5 (primary actions, highlights), orange #FF8A3D (warnings, scheduled), violet #A78BFA (system/AI), green #4ADE80 (success/posted), red #F87171 (errors/danger).
FONTS: Geist (sans) for everything; Geist Mono for small labels, eyebrows, chips and numbers.
LOGO: wordmark "video" in white + "zilla" in cyan, Geist semibold, no icon.
EYEBROW LABELS: small monospace muted text above headings, written like a code comment: cyan "// " followed by lowercase words, e.g. "// library".
PRIMARY BUTTON: solid cyan #38D9F5 with near-black text, radius 12px, soft cyan glow (0 0 22px rgba(56,217,245,0.35)).
SECONDARY BUTTON: transparent with 1px white-16% border, white text. GHOST: muted text only. DANGER: red text, red 40% border.
INPUTS: background #0A0D14, 1px white-16% border, radius 12px, white text, dim placeholder, cyan border on focus.
STATUS CHIPS: monospace 12px text inside a small rounded box (white 3.5% fill, 1px white 9% border) with a 6px glowing dot in the status colour.
BACKGROUND TEXTURE (marketing/auth pages only): a very faint dot grid (muted dots every 28px) fading out radially from the center.
Overall feel: calm, premium, techy, lots of breathing room, no gradients except glows, no illustrations, no stock photos.
```

---

## 2. Screens

### 2.1 Landing page

```
Landing page for videozilla (use the design system). Full-width dark page with the faint dot-grid texture.
Top bar (max width 1150px, centered): logo "videozilla" on the left; on the right a ghost "Sign in" button and a cyan primary "Get started" button.
Hero, centered, generous vertical space: eyebrow "// ai explainer reels · english + हिंदी" in monospace; headline in 60px Geist semibold, tight tracking, 2 lines: "Turn any topic into an animated explainer reel" where "animated explainer" is cyan with a soft glow; muted subtitle (18px, max 640px): "Videozilla writes the script, records the voiceover, animates every scene in sync with the narration, and posts it to your Instagram. You just approve."; one large cyan primary button "Create your first video".
Below the hero, a row of 3 equal cards (16px radius, translucent): each has a small monospace step number in an accent colour ("01" cyan, "02" violet, "03" orange), a bold title ("Idea", "Storyboard", "Video") and one muted sentence: "Type a topic, an idea or paste your notes. AI shapes it into a sharp angle." / "Script and animated scenes on one screen. Change anything by chatting." / "Voiceover, synced motion graphics, then post straight to Instagram."
```

### 2.2 Sign in

```
Sign-in page for videozilla (design system). Dark page with faint dot-grid texture; a single centered column 380px wide (no card).
Logo "videozilla" at top-left of the column. Eyebrow "// welcome back", heading "Sign in" (30px semibold).
Secondary full-width button "Continue with Google" with the Google G icon. A divider: thin lines with the word "or" in monospace dim text.
Fields with small muted labels: "Email", "Password". Full-width cyan primary button "Sign in".
Below: left link "Forgot password?" (muted), right link "Create account" (cyan).
```

### 2.3 Create account

```
Create-account page for videozilla (design system), same layout as the sign-in page.
Eyebrow "// get started", heading "Create your account". "Continue with Google" secondary button, "or" divider.
Fields: "Name", "Email", "Password" with hint text below in dim: "At least 8 characters". Full-width cyan primary button "Create account".
Footer text: "Already have an account? Sign in" with "Sign in" in cyan.
```

### 2.4 Check your email (verification)

```
Email verification notice for videozilla (design system), same centered 380px column with logo.
Eyebrow in orange: "// one more step". Heading "Check your email".
Muted paragraph: "We sent a verification link to dev@videozilla.test. Open it to activate your account — you'll be signed in automatically." (email in white).
Secondary full-width button "Resend verification email". Muted link "← Back to sign in".
```

### 2.5 Library — empty state

```
Signed-in app screen "Library" for videozilla (design system), desktop.
Left sidebar 240px with a right border (white 9%): logo "videozilla" at top; nav items with monospace numbers: "01 Library" (active: white text on white-6% background, number in cyan) and "02 Settings" (muted). At the bottom of the sidebar a small translucent card: "Dev Tester" (white), "dev@videozilla.test" (monospace dim), and a muted "Sign out" link.
Main area (max width 1150px, padding 40px): eyebrow "// library", heading "Your videos" (30px semibold); at the right a cyan primary button "+ Create video".
Toolbar: a segmented control in a translucent rounded box with tabs "All" (selected), "Drafts", "Ready", "Scheduled", "Posted"; next to it a search input "Search by title".
Empty state: a large dashed-border rounded panel, centered text: monospace "// no videos yet", heading "Create your first explainer", muted line "Try “How do vaccines work?”, “What is compound interest?” or “प्रकाश संश्लेषण कैसे होता है?”" (example titles in white).
```

### 2.6 Library — with videos

```
Same "Library" screen for videozilla but with videos. Above the grid, a small section with eyebrow in red "// needs attention" containing one card.
Grid of project cards, 3 per row (radius 16px, translucent fill, 1px border). Each card: a tall 9:10 dark preview area with a faint dot texture; inside it at top a monospace line "// english · ~60s" (or "// हिंदी · ~60s") and the video title in 20px semibold white (up to 3 lines).
Card footer: the title again in 14px, then a row with a status chip and a monospace dim time ("just now", "5 min ago", "2 d ago"), and a "⋯" menu button on the right.
Show 6 cards with these titles and statuses: "Why is the sky blue?" (chip "Draft · Idea", grey dot), "पौधे खाना कैसे बनाते हैं?" (chip "Ready to review", cyan dot), "How UPI moves money in 2 seconds" (chip "Ready", cyan dot), "Water cycle for class 6" (chip "Scheduled", orange dot), "Compound interest explained" (chip "Posted", green dot), "Newton's 3 laws" (chip "Needs attention", red dot — this one is in the needs-attention section).
On one card show the open "⋯" menu: a small dark popover with items "Rename", "Duplicate", "Delete" (Delete in red).
At the bottom center, a toast: dark raised pill with border: "Deleted “Why is the sky blue? (copy)”" and a cyan "Undo" link.
```

### 2.7 Project page

```
Signed-in "Video" project page for videozilla (design system), same left sidebar as the Library (Library item active).
Top: monospace muted link "← library". Title "Why is the sky blue?" (30px semibold) followed by a status chip "Draft · Idea" (grey dot).
A 3-step stepper as three equal boxes in a row: "01 Idea" (current: cyan 60% border, faint cyan tint, number in cyan), "02 Storyboard" and "03 Video" (dim text, 1px white-9% border).
Below, a two-column layout: left (wide) a tall card centered content: eyebrow in violet "// idea studio", heading "Plan your idea with AI", muted text "Find a topic, start from your own idea or paste notes — then generate the script and storyboard in one click."; right column (300px) a card with eyebrow "// settings" and a two-column definition list: Language — English; Length — ~60 seconds; Voice — Female voice; Style — Midnight.
```

### 2.8 Settings

```
Signed-in "Settings" page for videozilla (design system), same left sidebar (Settings item active, number in cyan). Content max width 760px.
Eyebrow "// settings", heading "Settings".
Card 1 "Profile & defaults" (heading 18px semibold) with muted sub-text "New videos start with these settings." A form in two columns: full-width "Display name" input; selects "Default language" (English / हिंदी (Hindi)), "Default length" (~60 seconds), "Default voice" (Female voice / Male voice — only these two), "Time zone" (Asia/Kolkata) with hint "Used for scheduling posts"; a checkbox row "Email me when a video is ready or a post goes live"; a cyan primary "Save changes" button with a green monospace "saved ✓" next to it.
Card 2 (one row): "Instagram" heading with muted line "Connect a Creator or Business account to post and schedule Reels." and on the right a status chip "coming in M6" (grey dot).
Card 3 (subtle red border): "Delete account" heading, muted "Permanently deletes your account, all videos and settings. This can't be undone.", an input labelled 'Type "DELETE" to confirm' and a red danger button "Delete my account".
```

---

## 3. After generating

- Name the Stitch project **"Videozilla — reference UI (M1)"**.
- Keep screen names identical to the headings above (Landing, Sign in, …).
- If Stitch drifts from the palette, re-paste the design system and ask: "Apply the videozilla design system exactly: background #030407, cyan #38D9F5 primary, Geist + Geist Mono."
