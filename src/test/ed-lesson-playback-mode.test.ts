import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const html = readFileSync(resolve(process.cwd(), "public/ed_master.html"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261110170500_add_lesson_web_playback_mode.sql"), "utf8");

function getRules() {
  const script = html.match(/<script id="edAuthRules">([\s\S]*?)<\/script>/);
  if (!script) throw new Error("edAuthRules script not found");
  const sandbox: { window: Record<string, any> } = { window: {} };
  runInNewContext(script[1], sandbox);
  return sandbox.window.EDAuthRules;
}

describe("per-lesson video playback mode", () => {
  const rules = getRules();

  it("keeps existing lessons web-enabled by default", () => {
    expect(rules.canShowLessonVideoOnWeb({}, false)).toBe(true);
    expect(rules.canShowLessonVideoOnWeb({ web_playback_enabled: true }, false)).toBe(true);
  });

  it("hides app-only videos from student web playback", () => {
    expect(rules.canShowLessonVideoOnWeb({ web_playback_enabled: false }, false)).toBe(false);
    expect(rules.canShowLessonVideoOnWeb({ webPlaybackEnabled: false }, false)).toBe(false);
  });

  it("blocks app-only lessons on the web even for teachers and admins", () => {
    expect(rules.canShowLessonVideoOnWeb({ web_playback_enabled: false }, true)).toBe(false);
    expect(rules.canShowLessonVideoOnWeb({ webPlaybackEnabled: false }, true)).toBe(false);
    expect(rules.canShowLessonVideoOnWeb({ webPlaybackEnabled: "false" }, true)).toBe(false);
    expect(rules.canShowLessonVideoOnWeb({ web_playback_enabled: 0 }, false)).toBe(false);
  });

  it("fails closed when lesson data is missing", () => {
    expect(rules.canShowLessonVideoOnWeb(null, true)).toBe(false);
  });

  it("persists the default true mode for all legacy lessons", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS web_playback_enabled boolean NOT NULL DEFAULT true");
  });

  it("adds the two requested choices to both lesson creation and edit screens", () => {
    expect(html).toContain('id="lessonWebPlaybackEnabled"');
    expect(html).toContain('id="editLessonWebPlaybackEnabled"');
    expect(html).toContain("المنصة والتطبيق");
    expect(html).toContain("التطبيق فقط");
    expect(html).toContain("web_playback_enabled: webPlaybackEnabled");
    expect(html).toContain("web_playback_enabled: editWebPlaybackEnabled");
  });

  it("filters app-only videos for every web role without a manager override", () => {
    expect(html).toContain("webVisibleLessonIds");
    expect(html).toContain("Re-read the authoritative playback flag to avoid stale browser caches.");
    expect(html).toContain(".select('web_playback_enabled')");
    expect(html).toContain("in('lesson_id', webVisibleLessonIds)");
    expect(html).toContain(".filter(l => isEdAllNativePlaybackApp() || (l.web_playback_enabled !== false && l.web_playback_enabled !== 'false' && l.web_playback_enabled !== 0))");
    expect(html).toContain("function isEdAllNativePlaybackApp()");
    expect(html).toContain("const canShowVideosOnWeb = isEdAllNativePlaybackApp() || window.EDAuthRules");
    expect(html).not.toContain("canPreviewAllLessonVideos || l.web_playback_enabled");
    expect(html).toContain("webPlaybackEnabled: l.web_playback_enabled !== false");
  });

  it("does not fall back to a direct YouTube iframe in an ordinary browser", () => {
    expect(html).toContain("Ordinary web playback is quality-extraction-only");
    expect(html).toContain("No automatic-quality YouTube fallback was opened.");
  });

  it("keeps the app-only notice while leaving lesson text and other files in the lesson view", () => {
    expect(html).toContain("الفيديو متاح من التطبيق فقط");
    expect(html).toContain("محتوى المحاضرة وملفاتها الأخرى تظل متاحة هنا");
    expect(html).toContain("if (!canShowVideosOnWeb)");
  });
});
