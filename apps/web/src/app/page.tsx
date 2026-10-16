import { ButtonLink, Eyebrow, Logo } from "@/components/ui";

const STEPS = [
  { n: "01", title: "Idea", body: "Type a topic, an idea or paste your notes. AI shapes it into a sharp angle.", color: "text-cyan" },
  { n: "02", title: "Storyboard", body: "Script and animated scenes on one screen. Change anything by chatting.", color: "text-violet" },
  { n: "03", title: "Video", body: "Voiceover, synced motion graphics, then post straight to Instagram.", color: "text-orange" },
];

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="dot-field pointer-events-none absolute inset-0" aria-hidden />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/sign-in" variant="ghost">
            Sign in
          </ButtonLink>
          <ButtonLink href="/sign-up">Get started</ButtonLink>
        </nav>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
        <Eyebrow>ai explainer reels · english + हिंदी</Eyebrow>
        <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Turn any topic into an <span className="text-glow text-cyan">animated explainer</span> reel
        </h1>
        <p className="max-w-2xl text-balance text-lg text-muted">
          Videozilla writes the script, records the voiceover, animates every scene in sync with the narration, and posts it to your
          Instagram. You just approve.
        </p>
        <div className="flex gap-3 pt-2">
          <ButtonLink href="/sign-up" className="px-6 py-3 text-base">
            Create your first video
          </ButtonLink>
        </div>

        <div className="mt-14 grid w-full gap-4 text-left sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-line bg-surface p-5">
              <p className={`font-mono text-sm ${s.color}`}>{s.n}</p>
              <p className="mt-2 text-lg font-semibold">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
