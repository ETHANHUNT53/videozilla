import { redirect } from "next/navigation";

/**
 * The F3.1 "Storyboard ready" list lived here; since F3.3 the Storyboard Review screen is the project page's Storyboard
 * step (your answer), so old links go there. The project page does the sign-in and 404 checks.
 */
export default async function StoryboardPage({ params }: PageProps<"/projects/[id]/storyboard">) {
  const { id } = await params;
  redirect(`/projects/${encodeURIComponent(id)}`);
}
