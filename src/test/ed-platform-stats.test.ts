import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261122180000_correct_platform_statistics_counts.sql"),
  "utf8"
);
const worker = readFileSync(
  resolve(process.cwd(), "workers/edall-assistant/index.js"),
  "utf8"
);

describe("verified platform statistics contract", () => {
  it("counts Auth accounts rather than only profiles", () => {
    expect(migration).toContain("FROM auth.users");
    expect(migration).toContain("FROM public.profiles");
    expect(migration).toContain("'unlinked_profiles',_unlinked_profiles");
    expect(migration).toContain("WHERE NOT EXISTS (");
    expect(migration).toContain("profile.id = user_account.id");
    expect(migration).not.toContain("GREATEST(_users - _profiles, 0)");
  });

  it("counts real exam attempts only when that optional table exists", () => {
    expect(migration).toContain("pg_catalog.to_regclass('public.exam_attempts')");
    expect(migration).toContain("FROM public.exam_attempts");
    expect(migration).toContain("_exam_attempts_tracked := true");
    expect(migration).not.toContain("SELECT count(*)::integer INTO _exam_attempts FROM public.exam_results");
  });

  it("preserves administrator AAL2 enforcement and verified integer checks", () => {
    expect(migration).toContain("public.admin_mfa_verified()");
    expect(migration).toContain("SET search_path = ''");
    expect(worker).toContain("Number.isSafeInteger(value)");
    expect(worker).toContain("snapshot.exam_attempts_tracked");
  });

  it("documents the database migration required before corrected statistics are available", () => {
    expect(worker).toContain("statistics_migration_required === true");
    expect(worker).toContain("قاعدة البيانات لم تُحدّث بعد");
  });

  it("does not silently display zero when attempt tracking is absent", () => {
    expect(worker).toContain("تتبّع المحاولات غير مفعّل في قاعدة البيانات");
  });
});
