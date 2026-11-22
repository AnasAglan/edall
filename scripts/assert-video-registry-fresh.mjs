import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function assertProviderRegistryFresh(registry) {
  const failures = [];
  if (registry?.sourcesUpdated?.piped !== true) {
    failures.push("Piped directory was not refreshed");
  }
  if (registry?.sourcesUpdated?.invidious !== true) {
    failures.push("Invidious directory was not refreshed");
  }
  if (registry?.refreshedDaily !== true) {
    const sourceErrors = Array.isArray(registry?.sourceErrors) ? registry.sourceErrors : [];
    failures.push(...(sourceErrors.length ? sourceErrors : ["At least one provider source is stale"]));
  }

  if (failures.length) {
    throw new Error(
      "Provider discovery is incomplete; the last-known registry was preserved:\n - " +
      [...new Set(failures)].join("\n - ")
    );
  }
  return true;
}

async function main() {
  const raw = await readFile(new URL("../public/video-instances.json", import.meta.url), "utf8");
  const registry = JSON.parse(raw);
  assertProviderRegistryFresh(registry);
  console.log("Both provider directories refreshed successfully.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
