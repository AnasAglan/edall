import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const edgeFunction = readFileSync(
  resolve(process.cwd(), "supabase/functions/authorize-offline-download/index.ts"),
  "utf8",
);
const lessonPolicyMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261114120000_harden_platform_security.sql"),
  "utf8",
);
const lessonAccessMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261115113000_enforce_course_and_admin_mfa.sql"),
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

  it("only exposes native download actions with valid course and lesson identifiers", () => {
    expect(html).toContain("test(String(courseId || ''))");
    expect(html).toContain("test(String(lessonId || ''))");
    expect(html).toContain("window.edallDesktop.isAndroid === true");
  });

  it("relies on the platform's existing lesson entitlement RLS policy", () => {
    expect(lessonPolicyMigration).toContain('CREATE POLICY "Entitled users can view lessons"');
    expect(lessonPolicyMigration).toContain("USING (public.can_access_lesson(id))");
    expect(lessonAccessMigration).toContain("CREATE OR REPLACE FUNCTION public.can_access_lesson(_lesson_id uuid)");
    expect(lessonAccessMigration).toContain("e.course_id=c.id AND e.user_id=auth.uid()");
    expect(lessonAccessMigration).toContain("c.price <= 0");
    expect(lessonAccessMigration).toContain("l.is_free = true");
    expect(lessonAccessMigration).toContain("public.has_course_capability(c.id,'content')");
    expect(edgeFunction).toContain('.from("lessons")');
    expect(edgeFunction).toContain('.from("lesson_videos")');
  });

  it("returns the authenticated server-side user id after the lesson/video authorization succeeds", () => {
    expect(edgeFunction).toContain("const { data: userData, error: userError } = await caller.auth.getUser()");
    expect(edgeFunction).toContain("lessonContainsRequestedVideo(videos, videoId)");
    expect(edgeFunction).toContain("user_id: userData.user.id");
    expect(edgeFunction).toContain("authorized: true");
  });

  it("does not block native downloads for lessons hidden from web playback", () => {
    // Native access is not tied to the browser-only playback flag.
    expect(edgeFunction).toContain('.select("id,course_id")');
    expect(edgeFunction).not.toContain('.select("id,course_id,web_playback_enabled")');
    expect(edgeFunction).not.toContain('.eq("web_playback_enabled", true)');
    expect(edgeFunction).toContain("if (!lesson)");
    expect(edgeFunction).toContain("lessonContainsRequestedVideo(videos, videoId)");
  });

  it("uses the caller JWT and does not elevate authorization with a service-role client", () => {
    expect(edgeFunction).toContain('global: { headers: { Authorization: authorization } }');
    expect(edgeFunction).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edgeFunction).toContain('.from("lessons")');
    expect(edgeFunction).toContain('.from("lesson_videos")');
    expect(edgeFunction).toContain("const { data: userData, error: userError } = await caller.auth.getUser()");
  });
});
