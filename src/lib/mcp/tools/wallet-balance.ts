import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function db(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_wallet_balance",
  title: "Get wallet balance",
  description: "Get the signed-in user's wallet balance and recent transactions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const uid = ctx.getUserId();
    const client = db(ctx);
    const [{ data: wallet }, { data: tx }] = await Promise.all([
      client.from("wallets").select("balance,updated_at").eq("user_id", uid).maybeSingle(),
      client.from("wallet_transactions").select("amount,type,note,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(10),
    ]);
    return {
      content: [{ type: "text", text: JSON.stringify({ balance: wallet?.balance ?? 0, transactions: tx ?? [] }, null, 2) }],
      structuredContent: { balance: wallet?.balance ?? 0, transactions: tx ?? [] },
    };
  },
});
