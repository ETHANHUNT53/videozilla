import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Before React hydrates, a form has no `onSubmit`: Enter would submit it natively. Without `method`, that's a GET,
 * and QA saw `GET /sign-in?email=…&password=<plaintext>` in the dev log. So the server HTML of every form must use
 * POST and ship its submit button disabled (a disabled default button blocks implicit submission).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams("token=t"),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("@/lib/api-client", () => ({ apiCall: async () => ({}), ApiClientError: class extends Error {} }));

import { ForgotPasswordForm, ResetPasswordForm, SignInForm, SignUpForm } from "./auth-forms";
import { ProfileSettingsForm } from "./settings";
import { WelcomeView } from "./welcome";

const profile = {
  displayName: "A",
  defaultLanguage: "en",
  defaultLengthPreset: 60,
  defaultVoiceGender: "female",
  defaultAudience: "students",
  defaultBoardOrExam: null,
  timezone: "Asia/Kolkata",
  emailNotifications: true,
  about: "",
};

const forms: [string, ComponentType<never>, object][] = [
  ["sign in", SignInForm as ComponentType<never>, { googleEnabled: false }],
  ["sign up", SignUpForm as ComponentType<never>, { googleEnabled: false }],
  ["forgot password", ForgotPasswordForm as ComponentType<never>, {}],
  ["reset password", ResetPasswordForm as ComponentType<never>, {}],
  ["settings", ProfileSettingsForm as ComponentType<never>, { profile }],
  ["welcome", WelcomeView as ComponentType<never>, { profile }],
];

describe("forms in the server HTML (before hydration)", () => {
  it.each(forms)("%s: method=post and the submit button disabled", (_, Form, props) => {
    const html = renderToString(createElement(Form, props as never));
    const formTags = html.match(/<form\b[^>]*>/g) ?? [];
    expect(formTags.length).toBeGreaterThan(0);
    for (const tag of formTags) expect(tag).toMatch(/method="post"/);
    const submits = html.match(/<button\b[^>]*type="submit"[^>]*>/g) ?? [];
    expect(submits.length).toBeGreaterThan(0);
    for (const tag of submits) expect(tag).toMatch(/\bdisabled=""/);
  });
});

describe("reset password errors", () => {
  it("a used, expired or unknown link never shows Better Auth's raw 'Invalid token'", async () => {
    const { resetErrorText } = await import("./auth-forms");
    expect(resetErrorText({ code: "INVALID_TOKEN", message: "Invalid token", status: 400 })).toBe("This reset link is invalid or has expired. Request a new one.");
    expect(resetErrorText({ message: "invalid token" })).toBe("This reset link is invalid or has expired. Request a new one.");
    expect(resetErrorText({ code: "PASSWORD_TOO_SHORT", message: "Password too short", status: 400 })).toBe("Password too short");
    expect(resetErrorText({ status: 500 })).toMatch(/on our side/);
  });
});
