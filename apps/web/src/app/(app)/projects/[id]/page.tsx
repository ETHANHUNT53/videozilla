import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, Chip, Eyebrow, Spinner, cx } from "@/components/ui";
import { STATUS_DISPLAY } from "@/lib/status";
import { requireUser } from "@/server/dal";
import { getProject } from "@/server/repos/projects";

export const metadata: Metadata = { title: "Video" };

const STEPS = [
  { id: "idea", label: "Idea", n: "01" },
  { id: "storyboard", label: "Storyboard", n: "02" },
  { id: "video", label: "Video", n: "03" },
] as const;

const VOICE_LABEL = { female: "Female voice", male: "Male voice" } as const;

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<Spinner label="Opening video…" />}>
      <ProjectContent params={params} />
    </Suspense>
  );
}

async function ProjectContent({ params }: { params: PageProps<"/projects/[id]">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await getProject(user.id, id);
  // Unknown or someone else's project: 404, never a hint that it exists.
  if (!project) notFound();

  const status = STATUS_DISPLAY[project.status];
  const stepIndex = project.status === "idea_draft" ? 0 : ["storyboard_generating", "storyboard_ready"].includes(project.status) ? 1 : 2;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/library" className="font-mono text-sm text-muted hover:text-fg">
          ← library
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
          <Chip color={status.color}>{status.label}</Chip>
        </div>
      </div>

      <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === stepIndex ? "step" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-xl border px-4 py-3",
              i === stepIndex ? "border-cyan/60 bg-cyan/5" : i < stepIndex ? "border-line bg-surface" : "border-line text-dim",
            )}
          >
            <span className={cx("font-mono text-xs", i <= stepIndex ? "text-cyan" : "text-dim")}>{s.n}</span>
            <span className="text-sm font-medium">{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
          <Eyebrow accent="text-violet">idea studio</Eyebrow>
          <p className="text-balance text-2xl font-semibold">Plan your idea with AI</p>
          <p className="max-w-md text-balance text-muted">
            Find a topic, start from your own idea or paste notes — then generate the script and storyboard in one click. Arriving in the next milestone (M2).
          </p>
        </Card>
        <Card className="flex flex-col gap-4 p-5">
          <Eyebrow>settings</Eyebrow>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-muted">Language</dt>
            <dd>{project.language === "hi" ? "हिंदी (Hindi)" : "English"}</dd>
            <dt className="text-muted">Length</dt>
            <dd>~{project.lengthPreset} seconds</dd>
            <dt className="text-muted">Voice</dt>
            <dd>{VOICE_LABEL[project.voiceGender]}</dd>
            <dt className="text-muted">Style</dt>
            <dd className="capitalize">{project.styleId}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}
