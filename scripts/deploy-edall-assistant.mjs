import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const geminiApiKey = process.env.GEMINI_API_KEY;
if (typeof geminiApiKey !== "string" || geminiApiKey.trim().length === 0) {
  console.error("Missing required Cloudflare Build secret: GEMINI_API_KEY");
  process.exit(1);
}

const secretsFile = join(tmpdir(), `edall-assistant-wrangler-secrets-${process.pid}.json`);
let exitCode = 1;

try {
  writeFileSync(secretsFile, JSON.stringify({ GEMINI_API_KEY: geminiApiKey }), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  const args = [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.assistant.toml",
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
  console.error("ED-ALL assistant deployment failed:", error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  try {
    rmSync(secretsFile, { force: true });
  } catch {
    // Best-effort cleanup; the temporary file is outside the repository.
  }
}

process.exitCode = exitCode;
