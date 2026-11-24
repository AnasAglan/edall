import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  edallCorsHeaders,
  isAllowedEdallOrigin,
} from "../_shared/app-origin.ts";
import { lessonContainsRequestedVideo } from "../_shared/offline-download.ts";

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

Deno.serve(async req => {
  const origin = req.headers.get("Origin");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const cors = edallCorsHeaders(origin, url);
  const originAllowed = isAllowedEdallOrigin(origin, url);

  if (req.method === "OPTIONS") {
    if (!originAllowed) return json({ error: "Origin is not allowed for this backend." }, 403, cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
  if (!originAllowed) return json({ error: "Origin is not allowed for this backend." }, 403, cors);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Authentication required." }, 401, cors);
  }

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anonKey) return json({ error: "Authorization backend is not configured." }, 503, cors);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Invalid or expired session." }, 401, cors);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid request body." }, 400, cors);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body." }, 400, cors);
    }

    const courseId = String(body.course_id || "");
    const lessonId = String(body.lesson_id || "");
    const videoId = String(body.video_id || "");
    if (!UUID.test(courseId) || !UUID.test(lessonId) || !YOUTUBE_ID.test(videoId)) {
      return json({ error: "Invalid course, lesson, or video identifier." }, 400, cors);
    }

    // These reads deliberately use the caller's JWT, never the service-role key.
    // The existing lessons and lesson_videos RLS policies call can_access_lesson().
    const { data: lesson, error: lessonError } = await caller
      .from("lessons")
      .select("id,course_id,web_playback_enabled")
      .eq("id", lessonId)
      .eq("course_id", courseId)
      .maybeSingle();

    if (lessonError) {
      console.error("Offline lesson authorization lookup failed", { code: lessonError.code });
      return json({ error: "Could not verify lesson access." }, 503, cors);
    }
    if (!lesson || lesson.web_playback_enabled !== true) {
      return json({ error: "This lesson is not available for offline playback." }, 403, cors);
    }

    const { data: videos, error: videosError } = await caller
      .from("lesson_videos")
      .select("video_url")
      .eq("lesson_id", lessonId);

    if (videosError) {
      console.error("Offline video authorization lookup failed", { code: videosError.code });
      return json({ error: "Could not verify video access." }, 503, cors);
    }
    if (!lessonContainsRequestedVideo(videos, videoId)) {
      return json({ error: "This YouTube video is not attached to the authorized lesson." }, 403, cors);
    }

    return json({
      authorized: true,
      user_id: userData.user.id,
      course_id: courseId,
      lesson_id: lessonId,
      video_id: videoId,
    }, 200, cors);
  } catch (error) {
    console.error("Offline download authorization failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Offline download authorization failed." }, 500, cors);
  }
});
