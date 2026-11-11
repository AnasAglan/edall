import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const template = readFileSync(resolve(process.cwd(), "supabase/templates/confirmation.html"), "utf8");
const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");

function loadAuthRules() {
  const match = html.match(/<script id="edAuthRules">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("edAuthRules script is missing");
  const sandbox: { window: Record<string, any> } = { window: {} };
  runInNewContext(match[1], sandbox);
  return sandbox.window.EDAuthRules;
}

describe("signup email OTP", () => {
  const rules = loadAuthRules();

  it("normalizes input to exactly six numeric characters", () => {
    expect(rules.normalizeSignupOtp("12a-34 56 78")).toBe("123456");
    expect(rules.normalizeSignupOtp("123")).toBe("123");
    expect(rules.isValidSignupOtp("123456")).toBe(true);
    expect(rules.isValidSignupOtp("12345")).toBe(false);
    expect(rules.isValidSignupOtp("12a456")).toBe(false);
  });

  it("routes only pending email confirmations to the verification page", () => {
    const start = html.indexOf("async function handleSignUp()");
    const end = html.indexOf("async function handleLogout()", start);
    const signup = html.slice(start, end);
    expect(signup).toContain("showPage('verifyEmailPage')");
    expect(signup).toContain("sessionStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, email)");
  });

  it("keeps normal sign-in password based and routes only unconfirmed accounts to verification", () => {
    const start = html.indexOf("async function handleSignIn()");
    const end = html.indexOf("async function handleSignUp()", start);
    const signIn = html.slice(start, end);
    expect(signIn).toContain("sb.auth.signInWithPassword({ email, password })");
    expect(signIn).not.toContain("verifyOtp");
    expect(signIn).toContain("window.EDAuthRules.isEmailNotConfirmedError(error)");
    expect(signIn).toContain("showPage('verifyEmailPage')");
    expect(rules.isEmailNotConfirmedError({ code: "email_not_confirmed" })).toBe(true);
    expect(rules.isEmailNotConfirmedError({ code: "invalid_credentials" })).toBe(false);
  });

  it("clears pending state when the user cancels or confirms through the email link", () => {
    expect(html).toContain("function cancelSignupVerification()");
    expect(html).toContain("clearPendingSignupVerification()");
    expect(html).toContain("clearPendingSignupVerification(session.user.email)");
    expect(html).toContain("addEventListener('click', cancelSignupVerification)");
  });

  it("verifies signup codes and supports resend", () => {
    expect(html).toContain("sb.auth.verifyOtp({ email, token, type: 'signup' })");
    expect(html).toContain("type: 'signup'");
    expect(html).toContain("options: { emailRedirectTo: window.location.origin + window.location.pathname }");
    expect(html).toContain("startSignupResendCooldown(60)");
    expect(html).toContain("maxlength=\"6\"");
    expect(html).toContain("autocomplete=\"one-time-code\"");
    expect(html).toContain("id=\"verifyEmailPage\"");
    expect(html).toContain("اكتب ما تم إرساله لبريدك أو اضغط زر التفعيل");
  });

  it("keeps both the six-digit code and the direct confirmation link in the template", () => {
    expect(template).toContain("{{ .Token }}");
    expect(template).toContain("{{ .ConfirmationURL }}");
    expect(template).toContain("https://edall.lovable.app/favicon.ico");
    expect(config).toContain("[auth.email.template.confirmation]");
    expect(config).toContain("./supabase/templates/confirmation.html");
  });
});

describe("app-only video download navigation", () => {
  it("uses the existing releases-page helper under the app-only notice", () => {
    const noticeStart = html.indexOf("الفيديو متاح من التطبيق فقط");
    const noticeEnd = html.indexOf("} else if (lesson.videos", noticeStart);
    const notice = html.slice(noticeStart, noticeEnd);
    expect(notice).toContain("تنزيل البرنامج");
    expect(notice).toContain("window.openReleasesPage()");
    expect(notice).toContain("Download the app");
  });
});
