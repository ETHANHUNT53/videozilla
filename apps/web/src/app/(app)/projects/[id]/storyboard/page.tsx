import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, Chip, Eyebrow, Slashes } from "@/components/ui";
import { requireUser } from "@/server/dal";
import { getProject } from "@/server/repos/projects";
import { getCurrentStoryboard } from "@/server/repos/storyboards";

export const metadata: Metadata = { title: "Storyboard" };

/** Like the project page: the reads come first, so an unknown id is a real 404 (see that page). */
export const instant = false;

const ROLE: Record<string, string> = { hook: "Hook", explain: "Explain", example: "Example", recap: "Recap", outro: "Outro" };
const LANGUAGE: Record<string, string> = { en: "English", hi: "हिंदी" };

/**
 * "Storyboard ready" (F3.1, your answer: a simple scene list): the current storyboard, read-only. F3.3 replaces it with
 * the review screen (Stitch 10: scene cards with animated thumbnails). No storyboard yet → back to the project.
 */
export default async function StoryboardPage({ params }: PageProps<"/projects/[id]/storyboard">) {
  const user = await requireUser();
  const { id } = await params;
  const current = await getCurrentStoryboard(user.id, id);
  if (!current) {
    if (await getProject(user.id, id)) redirect(`/projects/${id}`);
    notFound();
  }
  const { project, version } = current;
  const sb = version.data;
  const report = version.validationReport;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href={`/projects/${id}`} className="font-mono text-sm text-muted hover:text-fg">
          ← back to idea
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{sb.title}</h1>
          <Chip color="var(--green)">Storyboard ready</Chip>
        </div>
        <p className="text-lg text-muted">{sb.hook}</p>
        <p className="font-mono text-sm text-muted">
          <Slashes />
          {LANGUAGE[sb.language] ?? sb.language} · ~{report.estimatedDurationSec}s (target ~{sb.targetDurationSec}s) · {report.wordCount} words · {sb.scenes.length} scenes · version {version.version}
        </p>
        <p className="text-sm text-muted">
          {project.title !== sb.title ? `For your video “${project.title}”. ` : ""}The full storyboard screen, with animated scene previews, comes next.
        </p>
      </div>

      {report.warnings.some((w) => w.startsWith("narration is")) ? (
        <p role="status" className="rounded-xl border border-orange/40 bg-orange/5 px-4 py-3 text-sm">
          The script is a little {report.estimatedDurationSec > sb.targetDurationSec ? "long" : "short"} for a ~{sb.targetDurationSec}-second video. You can regenerate it from the idea step.
        </p>
      ) : null}

      <ol className="flex flex-col gap-3" aria-label="Scenes">
        {sb.scenes.map((scene, i) => {
          const chapter = scene.beat?.chapter;
          const startsChapter = chapter && sb.scenes[i - 1]?.beat?.chapter?.index !== chapter.index;
          return (
            <li key={scene.id} className="flex flex-col gap-3">
              {startsChapter ? (
                <p className="mt-2 font-mono text-sm text-cyan">
                  <Slashes />
                  chapter {chapter.index} · {chapter.headline}
                  {chapter.subhead ? <span className="text-muted"> — {chapter.subhead}</span> : null}
                </p>
              ) : null}
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                  <span className="text-fg">{String(i + 1).padStart(2, "0")}</span>
                  <span>{ROLE[scene.role] ?? scene.role}</span>
                  <span>{scene.type}</span>
                  {scene.beat?.mood ? <span>mood: {scene.beat.mood}</span> : null}
                  {scene.beat?.diagram ? <span>diagram step {scene.beat.diagram.step}</span> : null}
                </div>
                {scene.beats?.[0] ? <p className="font-semibold">{scene.beats.map((b) => b.headline.replace(/\*/g, "")).join(" · ")}</p> : null}
                <p className="text-sm leading-relaxed">{scene.narration}</p>
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="flex flex-col gap-2 p-4">
        <Eyebrow>instagram</Eyebrow>
        <p className="whitespace-pre-line text-sm">{sb.social.caption}</p>
        <p className="font-mono text-xs text-muted">{sb.social.hashtags.join(" ")}</p>
      </Card>
    </div>
  );
}
