import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const edgeFunction = readFileSync(
  resolve(process.cwd(), "supabase/functions/authorize-offline-download/index.ts"),
  "utf8",
);

describe("Android encrypted offline library account scoping", () => {
  it("only opens the local library after reading the current authenticated user", () => {
    expect(html).toContain("window.openYouTubeOfflineLibrary = async function()");
    expect(html).toContain("const { data, error } = await sb.auth.getSession()");
    expect(html).toContain("window.edallDesktop.openOfflineLibrary(userId)");
    expect(html).toContain('onclick="window.openYouTubeOfflineLibrary()"');
    expect(html).not.toContain('onclick="window.edallDesktop.openOfflineLibrary()"');
  });

  it("returns the authenticated server-side user id after the lesson/video authorization succeeds", () => {
    expect(edgeFunction).toContain("const { data: userData, error: userError } = await caller.auth.getUser()");
    expect(edgeFunction).toContain("lessonContainsRequestedVideo(videos, videoId)");
    expect(edgeFunction).toContain("user_id: userData.user.id");
    expect(edgeFunction).toContain("authorized: true");
  });

  it("does not block native downloads for lessons hidden from web playback", () => {
    expect(edgeFunction).toContain('.select("id,course_id")');
    expect(edgeFunction).not.toContain("web_playback_enabled");
    expect(edgeFunction).toContain("app-only lessons");
  });

  it("uses the caller JWT and does not elevate authorization with a service-role client", () => {
    expect(edgeFunction).toContain('global: { headers: { Authorization: authorization } }');
    expect(edgeFunction).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edgeFunction).not.toContain("service_role");
  });
});
