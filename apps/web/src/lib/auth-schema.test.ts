import { describe, expect, it } from "vitest";
import { checkAuthInput, firstProblem, signInSchema, signUpSchema } from "./auth-schema";

/** Sign-up and sign-in rules (2026-10-20: email + password, no email step), used by the forms and the server hook. */

const ok = { name: "Asha", email: "asha@example.com", password: "a good passphrase" };

describe("sign-up rules", () => {
  it("email trimmed and lowercased; name trimmed", () => {
    expect(signUpSchema.parse({ ...ok, email: "  Asha@Example.COM ", name: "  Asha  " })).toEqual({ ...ok, email: "asha@example.com" });
  });

  it.each([
    [{ email: "" }, "Enter your email address."],
    [{ email: "asha@" }, "Enter a valid email address, like name@example.com."],
    [{ email: "no-at-sign.example.com" }, "Enter a valid email address, like name@example.com."],
    [{ email: `${"a".repeat(250)}@x.co` }, "That email address is too long."],
    [{ password: "short" }, "Use at least 8 characters."],
    [{ password: "        " }, "Use at least 8 characters that aren't spaces."],
    [{ password: "x".repeat(129) }, "Use at most 128 characters."],
    [{ name: "  " }, "Enter your name."],
    [{ name: "n".repeat(61) }, "Use at most 60 characters for your name."],
  ])("%j → %s", (change, message) => {
    expect(firstProblem(signUpSchema.safeParse({ ...ok, ...change }))).toBe(message);
  });

  it("128 characters and Hindi passphrases are fine", () => {
    expect(signUpSchema.safeParse({ ...ok, password: "x".repeat(128) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...ok, password: "मेरा पासवर्ड बहुत लंबा है" }).success).toBe(true);
  });
});

describe("sign-in rules", () => {
  it("an older short password can still be typed (sign-in only checks the shape)", () => {
    expect(signInSchema.parse({ email: " Asha@Example.com", password: "old" })).toEqual({ email: "asha@example.com", password: "old" });
    expect(firstProblem(signInSchema.safeParse({ email: "asha@example.com", password: "" }))).toBe("Enter your password.");
  });
});

describe("checkAuthInput (the server's Better Auth hook)", () => {
  it("checks sign-up and sign-in bodies, normalises the email, and leaves other auth paths alone", () => {
    expect(checkAuthInput("/sign-up/email", { ...ok, email: "ASHA@example.com", callbackURL: "/library" })).toEqual({ ok: true, body: { ...ok, callbackURL: "/library" } });
    expect(checkAuthInput("/sign-in/email", { email: "x", password: "p" })).toEqual({ ok: false, message: "Enter a valid email address, like name@example.com." });
    expect(checkAuthInput("/sign-up/email", { ...ok, password: "1234567" })).toEqual({ ok: false, message: "Use at least 8 characters." });
    expect(checkAuthInput("/sign-up/email", null)).toMatchObject({ ok: false });
    expect(checkAuthInput("/sign-out", { anything: 1 })).toBeNull();
  });

  it("also covers the name change and the password change, so neither skips the sign-up rules", () => {
    expect(checkAuthInput("/update-user", { name: "n".repeat(61) })).toEqual({ ok: false, message: "Use at most 60 characters for your name." });
    expect(checkAuthInput("/update-user", { name: "  Asha  ", image: "https://x/y.png" })).toEqual({ ok: true, body: { name: "Asha", image: "https://x/y.png" } });
    expect(checkAuthInput("/update-user", { image: null })).toEqual({ ok: true, body: { image: null } });
    expect(checkAuthInput("/change-password", { currentPassword: "old", newPassword: "          " })).toEqual({ ok: false, message: "Use at least 8 characters that aren't spaces." });
    expect(checkAuthInput("/change-password", { currentPassword: "old", newPassword: "a good passphrase" })).toMatchObject({ ok: true });
  });
});
