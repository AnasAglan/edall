import { describe, expect, it } from "vitest";
import {
  extractAuthorizedYouTubeId,
  lessonContainsRequestedVideo,
} from "../../supabase/functions/_shared/offline-download";

describe("offline download authorization helper", () => {
  it("extracts only valid HTTPS YouTube video identifiers", () => {
    expect(extractAuthorizedYouTubeId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(extractAuthorizedYouTubeId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(extractAuthorizedYouTubeId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(extractAuthorizedYouTubeId("https://www.youtube-nocookie.com/embed/abcdefghijk")).toBe("abcdefghijk");
  });

  it("rejects non-YouTube hosts, insecure URLs, and malformed IDs", () => {
    expect(extractAuthorizedYouTubeId("http://www.youtube.com/watch?v=abcdefghijk")).toBeNull();
    expect(extractAuthorizedYouTubeId("https://youtube.com.evil.invalid/watch?v=abcdefghijk")).toBeNull();
    expect(extractAuthorizedYouTubeId("https://example.com/watch?v=abcdefghijk")).toBeNull();
    expect(extractAuthorizedYouTubeId("https://youtu.be/short")).toBeNull();
  });

  it("authorizes only when the exact YouTube ID exists in the selected lesson's rows", () => {
    const rows = [
      { video_url: "https://youtu.be/abcdefghijk" },
      { video_url: "https://youtube.com/watch?v=mnopqrstuvw" },
    ];
    expect(lessonContainsRequestedVideo(rows, "abcdefghijk")).toBe(true);
    expect(lessonContainsRequestedVideo(rows, "mnopqrstuvw")).toBe(true);
    expect(lessonContainsRequestedVideo(rows, "12345678901")).toBe(false);
    expect(lessonContainsRequestedVideo([], "abcdefghijk")).toBe(false);
    expect(lessonContainsRequestedVideo(null, "abcdefghijk")).toBe(false);
  });
});
