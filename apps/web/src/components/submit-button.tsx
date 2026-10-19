"use client";

import type { ComponentProps } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "./ui";

/**
 * A form's submit button that stays disabled until React has hydrated. Before that, Enter or a click would submit
 * the form natively (without our `onSubmit`), sending its fields to the page URL; with the default button disabled,
 * the browser doesn't submit at all. Forms that use it also set `method="post"`, so even a native submit never puts
 * fields (a password) in the URL or the server log.
 */
export function SubmitButton({ disabled, ...props }: Omit<ComponentProps<typeof Button>, "type">) {
  const hydrated = useHydrated();
  return <Button type="submit" disabled={!hydrated || disabled} {...props} />;
}
