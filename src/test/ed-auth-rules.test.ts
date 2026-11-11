import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const assistant = readFileSync(resolve(process.cwd(), "public/ed_assistant.js"), "utf8");
const setupUserMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261110170000_harden_setup_new_user_roles.sql"), "utf8");

function loadRules() {
  const m = html.match(/<script id="edAuthRules">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("edAuthRules block missing");
  const sandbox: { window: Record<string, any> } = { window: {} };
  runInNewContext(m[1], sandbox);
  return sandbox.window.EDAuthRules;
}

describe("signup password rule", () => {
  const r = loadRules();
  it("accepts exactly 5 characters without composition rules", () => {
    expect(r.validateSignupPassword("abcde", "ar").ok).toBe(true);
    expect(r.validateSignupPassword("11111", "en").ok).toBe(true);
  });
  it("rejects 4 characters with Arabic and English messages", () => {
    expect(r.validateSignupPassword("abcd", "ar").message).toContain("5");
    expect(r.validateSignupPassword("abcd", "en").message).toBe("Password must be at least 5 characters.");
  });
});

describe("auth session behavior", () => {
  const r = loadRules();
  it("signup without a session means email confirmation is pending, not logged in", () => {
    expect(r.signupOutcome({ user: { id: "u", identities: [{}] }, session: null })).toBe("confirm_email");
    expect(r.signupOutcome({ user: { id: "u" }, session: { access_token: "t" } })).toBe("signed_in");
    expect(r.signupOutcome({ user: { id: "u", identities: [] }, session: null })).toBe("already_exists");
  });
  it("does not mask every failure as invalid credentials", () => {
    expect(r.describeAuthError({ code: "email_not_confirmed" }, "en")).toMatch(/not confirmed/);
    expect(r.describeAuthError({ status: 429, message: "rate limit" }, "en")).toMatch(/Too many/);
    expect(r.describeAuthError({ code: "invalid_credentials" }, "en")).toBe("Invalid email or password.");
    expect(r.describeAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }, "en")).toMatch(/connection/);
  });
});

describe("auth state listener rules", () => {
  const r = loadRules();
  it("recognizes only signed-in, signed-out and token refresh events", () => {
    expect(r.authEventOutcome("SIGNED_OUT", null)).toBe("signed_out");
    expect(r.authEventOutcome("SIGNED_IN", { user: { id: "u" } })).toBe("signed_in");
    expect(r.authEventOutcome("TOKEN_REFRESHED", { user: { id: "u" } })).toBe("signed_in");
    expect(r.authEventOutcome("INITIAL_SESSION", { user: { id: "u" } })).toBe("ignore");
  });

  it("does not discard auth changes during initialization", () => {
    const start = html.indexOf("async function initializeApp()");
    const end = html.indexOf("async function loadCurrentUserFromSupabase", start);
    const init = html.slice(start, end);
    expect(init.indexOf("installAuthStateListener()")).toBeGreaterThan(-1);
    expect(init.indexOf("installAuthStateListener()")).toBeLessThan(init.indexOf("sb.auth.getSession()"));
    expect(init).toContain("flushPendingAuthState()");
  });

  it("does not silently swallow profile, role or setup RPC failures", () => {
    expect(html).toContain("profileResult.error || roleResult.error");
    expect(html).toContain("code: 'account_setup_failed'");
    expect(html).toContain("throw Object.assign(new Error(error.message");
  });
});


describe("signup email OTP", () => {
  const r = loadRules();

  it("accepts exactly six numeric digits", () => {
    expect(r.validateSignupOtp("123456")).toBe(true);
    expect(r.validateSignupOtp("000001")).toBe(true);
    expect(r.validateSignupOtp("12345")).toBe(false);
    expect(r.validateSignupOtp("1234567")).toBe(false);
    expect(r.validateSignupOtp("12a456")).toBe(false);
    expect(r.validateSignupOtp(" 123456")).toBe(false);
  });

  it("calculates the resend cooldown without returning negative seconds", () => {
    expect(r.signupResendSecondsRemaining(61000, 1000)).toBe(60);
    expect(r.signupResendSecondsRemaining(59000, 1000)).toBe(58);
    expect(r.signupResendSecondsRemaining(1000, 1000)).toBe(0);
    expect(r.signupResendSecondsRemaining(0, 1000)).toBe(0);
  });

  it("keeps normal sign-in password-only and verifies only new signup confirmations", () => {
    const signInStart = html.indexOf("async function handleSignIn()");
    const signUpStart = html.indexOf("async function handleSignUp()", signInStart);
    const signInSource = html.slice(signInStart, signUpStart);
    expect(signInSource).toContain("sb.auth.signInWithPassword");
    expect(signInSource).not.toContain("verifyOtp");
    expect(signInSource).not.toContain("sb.auth.resend");

    expect(html).toContain("sb.auth.verifyOtp({ email, token, type: 'signup' })");
    expect(html).toContain("sb.auth.resend({");
    expect(html).toContain("type: 'signup'");
    expect(html).toContain("اكتب ما تم إرساله لبريدك أو اضغط زر التفعيل");
  });

  it("routes pending signups to the verification page without retaining the password", () => {
    const signUpStart = html.indexOf("async function handleSignUp()");
    const logoutStart = html.indexOf("async function handleLogout()", signUpStart);
    const signUpSource = html.slice(signUpStart, logoutStart);
    expect(signUpSource).toContain("showEmailVerificationPage(email, true)");
    expect(signUpSource).toContain("document.getElementById('signUpPass').value = ''");
    expect(html).toContain("sessionStorage.setItem(EDALL_PENDING_SIGNUP_EMAIL_KEY, normalizedEmail)");
  });
});

describe("database account bootstrap security", () => {
  it("limits authenticated calls to the caller's own account", () => {
    expect(setupUserMigration).toContain("auth.uid() <> _user_id");
    expect(setupUserMigration).toContain("Not authorized to initialize another account");
  });

  it("does not allow the account bootstrap function to change an existing role", () => {
    expect(setupUserMigration).toContain("IF auth.uid() IS NOT NULL THEN");
    expect(setupUserMigration).toContain("IF NOT _has_role THEN");
    expect(setupUserMigration).toContain("REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text, text) FROM PUBLIC, anon;");
    expect(setupUserMigration).toContain("GRANT EXECUTE ON FUNCTION public.setup_new_user(uuid, text, text, text) TO authenticated, service_role;");
    const existingRoleBlock = setupUserMigration.slice(setupUserMigration.indexOf("IF auth.uid() IS NOT NULL THEN"), setupUserMigration.indexOf("-- This branch is for trusted"));
    expect(existingRoleBlock).not.toContain("DELETE FROM public.user_roles");
    expect(existingRoleBlock).not.toContain("INSERT INTO public.user_roles");
  });
});

describe("assistant visibility", () => {
  const helperStart = assistant.indexOf("function canAccessAssistant(u){");
  if (helperStart < 0) throw new Error("assistant access helper missing");
  const helperEnd = assistant.indexOf("}", helperStart);
  if (helperEnd < 0) throw new Error("assistant access helper is incomplete");
  const helperSource = assistant.slice(helperStart, helperEnd + 1);
  const fn = new Function("return (" + helperSource + ")")() as (u: unknown) => boolean;
  it("is visible only to admin and teacher", () => {
    expect(fn({ id: "1", roles: ["student"] })).toBe(false);
    expect(fn(null)).toBe(false);
    expect(fn({ id: "1", roles: ["teacher"] })).toBe(true);
    expect(fn({ id: "1", roles: ["admin"] })).toBe(true);
  });
});
