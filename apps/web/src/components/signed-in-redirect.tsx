import { Suspense } from "react";
import { redirectIfSignedIn } from "@/server/dal";

async function Check() {
  await redirectIfSignedIn();
  return null;
}

/** Sends users who are really signed in (checked against the database) from an auth page to the library. */
export function SignedInRedirect() {
  return (
    <Suspense fallback={null}>
      <Check />
    </Suspense>
  );
}
