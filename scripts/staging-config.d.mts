export const STAGING_PROJECT_REF: string;
export const STAGING_ASSISTANT_URL: string;
export const STAGING_BACKEND_ORIGINS: string[];
export interface StagingConfig {
  projectId: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  assistantUrl: string;
}
export function validateStagingConfig(env: Record<string, string | undefined>): StagingConfig;
export function renderStagingConfig(env: Record<string, string | undefined>): string;
export function stagingConfigPlugin(): {
  name: string;
  configResolved(config: { mode: string; envDir: string }): void;
  configureServer(server: { middlewares: { use(handler: (req: { url?: string }, res: { setHeader(name: string, value: string): void; end(value: string): void }, next: () => void) => void): void } }): void;
  generateBundle(this: { emitFile(asset: { type: "asset"; fileName: string; source: string }): unknown }): void;
};