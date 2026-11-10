import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const assistant = readFileSync(resolve(process.cwd(), "public/ed_assistant.js"), "utf8");

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
