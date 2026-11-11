import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    expect(deletionFunction).toContain('authGoneCode === "user_not_found"');
    expect(deletionFunction).toContain("!authGoneCode && authGoneStatus === 404");
    expect(deletionFunction).toContain("if (!authCheckAcceptedAsGone)");
    expect(deletionFunction).toContain("if (profileCheck.data || (rolesCheck.data || []).length || authCheck.data?.user)");
    expect(deletionFunction).toContain("success: true,\n      deleted: true,\n      verified: true");
  });
});
