import { redirect } from "next/navigation";

/**
 * No longer used (2026-10-20): Videozilla sends no email for now, so there's nothing to verify and no reset link.
 * Old links land on sign-in (which sends a signed-in visitor on to the Library).
 */
export default function Page() {
  redirect("/sign-in");
}
