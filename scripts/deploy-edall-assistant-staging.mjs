import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Manual-only Staging helper: reads only Staging secrets and targets only the dedicated Staging Worker.
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
if (typeof publishableKey !== "string" || !publishableKey.trim()) {
  console.error("Missing required Staging secret: STAGING_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}
const geminiApiKey = process.env.STAGING_GEMINI_API_KEY;
const stagingSecrets = { STAGING_SUPABASE_PUBLISHABLE_KEY: publishableKey };
if (typeof geminiApiKey === "string" && geminiApiKey.trim()) {
  stagingSecrets.STAGING_GEMINI_API_KEY = geminiApiKey;
}

const secretsFile = join(tmpdir(), `edall-assistant-staging-wrangler-secrets-${process.pid}.json`);
let exitCode = 1;

try {
  writeFileSync(secretsFile, JSON.stringify(stagingSecrets), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  const args = [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.assistant.staging.toml",
    "--secrets-file",
    secretsFile,
  ];
  if (process.argv.includes("--dry-run")) args.push("--dry-run");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} catch (error) {
  console.error("ED-ALL Staging assistant deployment failed:", error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  try {
    rmSync(secretsFile, { force: true });
  } catch {
    // Best-effort cleanup; the temporary file is outside the repository.
  }
}

process.exitCode = exitCode;