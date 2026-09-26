import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function db(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_courses",
  title: "List courses",
  description: "List available courses on the platform, with optional text search on title/description.",
  inputSchema: {
    search: z.string().optional().describe("Optional search term for course title or description."),
    limit: z.number().int().min(1).max(50).optional().describe("Max number of courses to return (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = db(ctx).from("courses").select("id,title,description,price,image_url,created_at").limit(limit ?? 20);
    if (search && search.trim()) {
      // Strip PostgREST filter-syntax characters so the search text is treated
      // as a literal pattern and cannot inject additional filter logic.
      const term = search.replace(/[(),."\\%_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
      if (term) q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { courses: data },
    };
  },
});
