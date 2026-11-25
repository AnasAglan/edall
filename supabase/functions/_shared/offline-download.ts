const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractAuthorizedYouTubeId(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;

    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] || null;
    } else if (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    ) {
      id = url.searchParams.get("v");
      if (!id) {
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
        id = match?.[1] || null;
      }
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function lessonContainsRequestedVideo(
  videoRows: Array<{ video_url?: unknown }> | null | undefined,
  requestedVideoId: string,
): boolean {
  if (!YOUTUBE_ID.test(requestedVideoId) || !Array.isArray(videoRows)) return false;
  return videoRows.some(row => extractAuthorizedYouTubeId(row?.video_url) === requestedVideoId);
}
