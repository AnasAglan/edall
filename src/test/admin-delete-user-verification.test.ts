import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDefinitivelyMissingAuthUser } from "../../supabase/functions/_shared/delete-user-verification";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const deletionFunction = readFileSync(resolve(process.cwd(), "supabase/functions/admin-delete-user/index.ts"), "utf8");

describe("admin user deletion verification", () => {
  it("does not show success unless the server confirms success, deletion, and verification", () => {
    expect(html).toContain("data.success !== true || data.deleted !== true || data.verified !== true");
    expect(html).toContain("sb.from('profiles').select('id').eq('id', userId).maybeSingle()");
    expect(html).toContain("sb.from('user_roles').select('user_id').eq('user_id', userId).limit(1)");
    expect(html).toContain("users.splice(userIndex, 1)");
  });

  it("does not treat arbitrary Auth lookup errors as proof that the user is gone", () => {
    expect(deletionFunction).toContain("isDefinitivelyMissingAuthUser(authCheck)");
    expect(deletionFunction).not.toContain("!authCheck.error ||");
    expect(deletionFunction).toContain("if (!authCheckAcceptedAsGone)");
    expect(deletionFunction).toContain("if (profileCheck.data || (rolesCheck.data || []).length || authCheck.data?.user)");
    expect(deletionFunction).toContain("success: true,\n      deleted: true,\n      verified: true");
  });

  it("requires an explicit Auth 404/not-found error and rejects empty or ambiguous lookups", () => {
    expect(isDefinitivelyMissingAuthUser({ error: { code: "user_not_found", status: 404 } })).toBe(true);
    expect(isDefinitivelyMissingAuthUser({ error: { status: 404 } })).toBe(true);
    expect(isDefinitivelyMissingAuthUser({ data: { user: null }, error: null })).toBe(false);
    expect(isDefinitivelyMissingAuthUser({ error: { code: "unexpected_failure", status: 500 } })).toBe(false);
    expect(isDefinitivelyMissingAuthUser({ data: { user: { id: "user-1" } }, error: null })).toBe(false);
  });
});
