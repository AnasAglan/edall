import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const appEntryHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const assistantWorker = readFileSync(resolve(process.cwd(), "workers/edall-assistant/index.js"), "utf8");
const assistant = readFileSync(resolve(process.cwd(), "public/ed_assistant.js"), "utf8");
const setupUserMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261110170000_harden_setup_new_user_roles.sql"), "utf8");
const secureSetupMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261115120000_serialize_initial_admin_bootstrap.sql"), "utf8");
const accountTriggerMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261118190000_fix_auth_account_provisioning.sql"), "utf8");
const orphanAccountRepairMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261118193000_repair_orphaned_auth_profiles.sql"), "utf8");

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
    expect(r.describeAuthError({ code: "invalid_credentials" }, "en")).toContain("Invalid email or password.");
    expect(r.describeAuthError({ code: "invalid_credentials" }, "en")).toContain("Forgot password?");
    expect(r.describeAuthError({ code: "invalid_credentials" }, "ar")).toContain("نسيت كلمة المرور؟");
    expect(r.describeAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }, "en")).toMatch(/connection/);
  });
});

describe("auth state listener rules", () => {
  const r = loadRules();
  it("recognizes sign-in, sign-out, token refresh and password recovery events", () => {
    expect(r.authEventOutcome("SIGNED_OUT", null)).toBe("signed_out");
    expect(r.authEventOutcome("SIGNED_IN", { user: { id: "u" } })).toBe("signed_in");
    expect(r.authEventOutcome("TOKEN_REFRESHED", { user: { id: "u" } })).toBe("signed_in");
    expect(r.authEventOutcome("PASSWORD_RECOVERY", { user: { id: "u" } })).toBe("password_recovery");
    expect(r.authEventOutcome("PASSWORD_RECOVERY", null)).toBe("ignore");
    expect(r.authEventOutcome("INITIAL_SESSION", { user: { id: "u" } })).toBe("ignore");
  });

  it("provides a complete self-service password recovery flow in the web login page", () => {
    expect(html).toContain('id="btnForgotPassword"');
    expect(html).toContain("async function requestPasswordReset()");
    expect(html).toContain("sb.auth.resetPasswordForEmail(email");
    expect(html).toContain("redirectTo: window.location.origin + window.location.pathname");
    expect(html).toContain("if (outcome === 'password_recovery')");
    expect(html).toContain("sb.auth.updateUser({ password })");
    expect(html).toContain("edRecoveryConfirmPassword");
  });

  it("does not discard auth changes during initialization", () => {
    const start = html.indexOf("async function initializeApp()");
    const end = html.indexOf("async function loadCurrentUserFromSupabase", start);
    const init = html.slice(start, end);
    expect(init.indexOf("installAuthStateListener()")).toBeGreaterThan(-1);
    expect(init.indexOf("installAuthStateListener()")).toBeLessThan(init.indexOf("sb.auth.getSession()"));
    expect(init).toContain("flushPendingAuthState()");
  });

  it("does not call the service-role-only account bootstrap RPC from a browser session", () => {
    expect(html).not.toContain("sb.rpc('setup_new_user'");
    expect(html).not.toContain("ensureUserAccountRecord(");
    expect(html).toContain("profileResult.error || roleResult.error");
    expect(html).toContain("code: 'account_setup_failed'");
    expect(html).toContain("Your session is valid, but your account profile or role is not ready.");
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


describe("password recovery redirect routing", () => {
  it("preserves query and hash values when the root redirects into the platform", () => {
    expect(appEntryHtml).toContain('location.replace("/ed_master.html" + location.search + location.hash);');
  });

  it("sends both administrator-created and administrator-requested password resets directly to the auth page", () => {
    const redirectCall = 'recoveryUrl.searchParams.set("redirect_to", new URL("/ed_master.html", env.WORKER_APP_ORIGIN).href);';
    const redirectCallCount = assistantWorker.split(redirectCall).length - 1;
    expect(redirectCallCount).toBe(2);
    expect(assistantWorker).not.toContain('recoveryUrl.searchParams.set("redirect_to", env.WORKER_APP_ORIGIN)');
  });
});

describe("legacy auth account repair", () => {
  it("repairs only profiles missing for accounts that already have a role", () => {
    expect(orphanAccountRepairMigration).toContain("LEFT JOIN public.profiles AS p ON p.id = u.id");
    expect(orphanAccountRepairMigration).toContain("WHERE p.id IS NULL");
    expect(orphanAccountRepairMigration).toContain("FROM public.user_roles AS r");
    expect(orphanAccountRepairMigration).toContain("PERFORM public.setup_new_user(");
  });

  it("fills missing wallets without changing existing balances or roles", () => {
    expect(orphanAccountRepairMigration).toContain("INSERT INTO public.wallets (user_id, balance)");
    expect(orphanAccountRepairMigration).toContain("LEFT JOIN public.wallets AS w ON w.user_id = u.id");
    expect(orphanAccountRepairMigration).toContain("ON CONFLICT (user_id) DO NOTHING");
    expect(orphanAccountRepairMigration).not.toMatch(/UPDATE\s+public\.wallets/i);
    expect(orphanAccountRepairMigration).not.toMatch(/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.user_roles/i);
    expect(orphanAccountRepairMigration).not.toMatch(/UPDATE\s+auth\.users/i);
  });
});

describe("trusted auth account provisioning", () => {
  it("creates profile, wallet, and only allowed signup roles in the auth trigger", () => {
    expect(accountTriggerMigration).toContain("CREATE OR REPLACE FUNCTION public.handle_new_user()");
    expect(accountTriggerMigration).toContain("INSERT INTO public.profiles");
    expect(accountTriggerMigration).toContain("INSERT INTO public.wallets");
    expect(accountTriggerMigration).toContain("pg_advisory_xact_lock");
    expect(accountTriggerMigration).toContain("_requested_role = 'teacher'");
    expect(accountTriggerMigration).toContain("_target_role := 'student'::public.app_role");
    expect(accountTriggerMigration).toContain("_target_role := 'admin'::public.app_role");
    expect(accountTriggerMigration).toContain("REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated");
    expect(accountTriggerMigration).toContain("EXECUTE FUNCTION public.handle_new_user()");
  });

  it("keeps privileged setup_new_user unavailable to browser roles", () => {
    expect(secureSetupMigration).toContain("REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text, text)");
    expect(secureSetupMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(secureSetupMigration).toContain("TO service_role");
    expect(accountTriggerMigration).not.toContain("GRANT EXECUTE ON FUNCTION public.setup_new_user");
  });
});
