import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("wallet and payment-provider audit coverage", () => {
  const migration = read("supabase/migrations/20261123130000_audit_wallet_and_provider_changes.sql");
  const sqlTests = read("supabase/tests/admin_operations_audit_test.sql");

  it("audits wallet transaction records and balance mutations", () => {
    expect(migration).toContain("audit_wallet_transaction_mutations");
    expect(migration).toContain("audit_wallet_balance_mutations");
    expect(migration).toContain("public.write_platform_audit_event");
  });

  it("audits provider activation without logging secret values", () => {
    expect(migration).toContain("audit_payment_provider_setting_mutations");
    expect(migration).toContain("secret_binding_name");
    expect(migration).toContain("Never log a credential value");
    expect(migration).not.toContain("FAWRY_SECURE_KEY = ");
  });

  it("protects all trigger functions and keeps the audit log immutable", () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(3);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(3);
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(sqlTests).toContain("platform_audit_log_immutable");
    expect(sqlTests).toContain("NOT has_function_privilege");
  });
});
