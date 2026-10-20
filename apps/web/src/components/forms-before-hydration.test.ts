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

import { authErrorText, SignInForm, SignUpForm } from "./auth-forms";
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

describe("sign-in and sign-up (no email step, 2026-10-20)", () => {
  it("no 'Forgot password' link, and no verify-email step in the forms", () => {
    const html = renderToString(createElement(SignInForm, { googleEnabled: false }));
    expect(html).not.toMatch(/forgot-password|Forgot password/i);
    expect(html).toContain("/sign-up");
  });

  it("the browser's own validation is off (our Zod messages show), but the email field keeps type=email for phone keyboards", () => {
    for (const Form of [SignInForm, SignUpForm]) {
      const html = renderToString(createElement(Form, { googleEnabled: false }));
      const form = html.match(/<form[^>]*>/)?.[0] ?? "";
      expect(form.toLowerCase()).toContain('novalidate=""');
      const email = html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? "";
      expect(email).toContain('type="email"');
    }
  });

  it("losing a sign-up race (FAILED_TO_CREATE_USER) reads like any existing account", () => {
    expect(authErrorText({ status: 422, code: "FAILED_TO_CREATE_USER", message: "Failed to create user" }, "x")).toBe("An account with this email already exists. Sign in instead.");
    expect(authErrorText({ status: 400, message: "Failed to create user" }, "x")).toBe("An account with this email already exists. Sign in instead.");
  });

  it("Better Auth's errors in our words", () => {
    expect(authErrorText({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, "x")).toBe("That email and password don't match an account.");
    expect(authErrorText({ status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." }, "x")).toBe("An account with this email already exists. Sign in instead.");
    expect(authErrorText({ status: 429, message: "Too many requests" }, "x")).toBe("Too many attempts. Wait a minute and try again.");
    expect(authErrorText({ status: 500 }, "x")).toMatch(/on our side/);
    expect(authErrorText({ status: 400, message: "Enter a valid email address, like name@example.com." }, "x")).toBe("Enter a valid email address, like name@example.com."); // the server's Zod message
  });
});
