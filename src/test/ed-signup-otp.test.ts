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

describe("signup email verification page (link-only)", () => {
  const rules = loadAuthRules();

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

  it("shows no OTP input or code-verify button on the verification page", () => {
    const start = html.indexOf('id="verifyEmailPage"');
    const end = html.indexOf('id="adminPage"', start);
    const page = html.slice(start, end);
    expect(page).not.toContain('id="signupOtpCode"');
    expect(page).not.toContain('id="btnVerifySignupOtp"');
    expect(html).not.toContain("handleVerifySignupOtp");
    expect(html).not.toContain("sb.auth.verifyOtp");
  });

  it("keeps the resend button, cooldown, and back-to-login button", () => {
    const start = html.indexOf('id="verifyEmailPage"');
    const end = html.indexOf('id="adminPage"', start);
    const page = html.slice(start, end);
    expect(page).toContain('id="btnResendSignupOtp"');
    expect(page).toContain('id="verifyEmailBackBtn"');
    expect(page).toContain('id="pendingSignupEmailLabel"');
    expect(html).toContain("type: 'signup'");
    expect(html).toContain("options: { emailRedirectTo: window.location.origin + window.location.pathname }");
    expect(html).toContain("startSignupResendCooldown(60)");
    expect(html).toContain("addEventListener('click', resendSignupVerificationEmail)");
  });

  it("tells the student to open the email and press the activation button, with no code entry", () => {
    expect(html).toContain("تم إرسال رسالة تفعيل إلى بريدك الإلكتروني. افتح الرسالة واضغط على زر تفعيل الحساب لإكمال التسجيل.");
    expect(html).toContain("لا تحتاج إلى إدخال أي رمز");
    expect(html).toContain("أرسلنا رسالة التفعيل إلى:");
    expect(html).not.toContain("أرسلنا الرمز إلى:");
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
  
describe("confirmation email template", () => {
  it("matches the link-only activation page instead of asking users to enter an OTP", () => {
    expect(template).toContain("{{ .ConfirmationURL }}");
    expect(template).not.toContain("{{ .Token }}");
    expect(template).not.toMatch(/رمز التحقق|أدخل الرمز|استخدم رمز/);
    expect(template).toContain("اضغط على زر التفعيل");
    expect(config).toContain('subject = "تفعيل حسابك في ED-ALL"');
  });
});
