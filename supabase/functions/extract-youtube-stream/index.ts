import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// خوادم استخراج مفتوحة سريعة للتنقل بينها تلقائياً كشبكة أمان
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.jing.rocks",
  "https://invidious.einfachzocken.eu"
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { videoId } = await req.json();
    if (!videoId) {
      return new Response(JSON.stringify({ error: "Missing videoId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let videoData = null;

    // تجربة الخوادم بالتسلسل في حال تأخر أو تعطل أي منها
    for (const host of INVIDIOUS_INSTANCES) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500); // مهلة 3.5 ثوانٍ لكل سيرفر

        const res = await fetch(`${host}/api/v1/videos/${videoId}?fields=title,formatStreams,adaptiveFormats,hlsUrl`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          videoData = await res.json();
          if (videoData && (videoData.formatStreams?.length || videoData.hlsUrl)) {
            break;
          }
        }
      } catch (_) {
        // الانتقال للسيرفر التالي في القائمة
      }
    }

    if (!videoData) {
      return new Response(JSON.stringify({ success: false, message: "Could not extract streams" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // تجهيز مصفوفة الجودات المتوفرة مع الصوت
    const qualities: { label: string; height: number; url: string }[] = [];

    if (Array.isArray(videoData.formatStreams)) {
      videoData.formatStreams.forEach((fmt: any) => {
        if (fmt.url && fmt.resolution) {
          const h = parseInt(fmt.resolution, 10) || 360;
          qualities.push({
            label: `${h}p`,
            height: h,
            url: fmt.url
          });
        }
      });
    }

    // ترتيب الجودات من الأعلى للأقل
    qualities.sort((a, b) => b.height - a.height);

    return new Response(JSON.stringify({
      success: true,
      title: videoData.title || "",
      hlsUrl: videoData.hlsUrl || null,
      qualities
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
