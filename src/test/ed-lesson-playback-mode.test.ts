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

  it("still lets the owning teacher or admin preview an app-only lesson", () => {
    expect(rules.canShowLessonVideoOnWeb({ web_playback_enabled: false }, true)).toBe(true);
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

  it("does not request app-only video rows for ordinary web student sessions", () => {
    expect(html).toContain("webVisibleLessonIds");
    expect(html).toContain("in('lesson_id', webVisibleLessonIds)");
    expect(html).toContain("webPlaybackEnabled: l.web_playback_enabled !== false");
  });

  it("keeps the app-only notice while leaving lesson text and other files in the lesson view", () => {
    expect(html).toContain("الفيديو متاح من التطبيق فقط");
    expect(html).toContain("محتوى المحاضرة وملفاتها الأخرى تظل متاحة هنا");
    expect(html).toContain("if (!canShowVideosOnWeb)");
  });
});
