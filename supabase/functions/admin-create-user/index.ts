import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://edall.lovable.app";

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin === ALLOWED_ORIGIN ? { "Access-Control-Allow-Origin": ALLOWED_ORIGIN } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin is not allowed." }, 403, cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin is not allowed." }, 403, cors);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "يجب تسجيل الدخول بصلاحية مدير." }, 401, cors);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
      Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
      return json({ error: "إعدادات خدمة إنشاء الحساب غير مكتملة." }, 500, cors);
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    const caller = callerData?.user;
    if (callerError || !caller) return json({ error: "الجلسة غير صالحة أو انتهت." }, 401, cors);

    const { data: isAdmin, error: roleError } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (roleError || isAdmin !== true) {
      return json({ error: "إنشاء الحسابات متاح للمدير فقط." }, 403, cors);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "بيانات الطلب غير صالحة." }, 400, cors);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "تعذر قراءة بيانات الطلب." }, 400, cors);
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? body.role : "student";

    if (!validEmail(email)) return json({ error: "البريد الإلكتروني غير صالح." }, 400, cors);
    if (!name || name.length > 120) return json({ error: "الاسم مطلوب ويجب ألا يتجاوز 120 حرفًا." }, 400, cors);
    if (password.length < 12 || password.length > 256) {
      return json({ error: "كلمة المرور المؤقتة يجب أن تتكون من 12 حرفًا على الأقل." }, 400, cors);
    }
    if (!["student", "teacher", "admin"].includes(role)) {
      return json({ error: "الدور المطلوب غير صالح." }, 400, cors);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, requested_role: role },
    });
    if (createError || !created?.user?.id) {
      return json({ error: createError?.message || "تعذر إنشاء حساب المصادقة." }, 409, cors);
    }

    const newUserId = created.user.id;
    let setupComplete = false;
    try {
      // Check the bootstrap RPC rather than treating the Auth user alone as a complete account.
      const { error: setupError } = await adminClient.rpc("setup_new_user", {
        _user_id: newUserId,
        _name: name,
        _email: email,
        _requested_role: role,
      });
      if (setupError) throw new Error("تعذر إنشاء ملف الحساب والمحفظة: " + setupError.message);

      // The signup trigger may have provisioned the default student role. This is a trusted
      // service-role operation for a brand-new account, not a client-facing role-change path.
      const { error: clearRoleError } = await adminClient.from("user_roles").delete().eq("user_id", newUserId);
      if (clearRoleError) throw new Error("تعذر ضبط صلاحية الحساب الجديد: " + clearRoleError.message);

      const { error: roleInsertError } = await adminClient.from("user_roles").insert({
        user_id: newUserId,
        role,
      });
      if (roleInsertError) throw new Error("تعذر حفظ صلاحية الحساب الجديد: " + roleInsertError.message);

      const [profileResult, rolesResult, walletResult] = await Promise.all([
        adminClient.from("profiles").select("id,name,email").eq("id", newUserId).maybeSingle(),
        adminClient.from("user_roles").select("role").eq("user_id", newUserId),
        adminClient.from("wallets").select("user_id,balance").eq("user_id", newUserId).maybeSingle(),
      ]);
      const verificationErrors = [profileResult.error, rolesResult.error, walletResult.error].filter(Boolean);
      if (verificationErrors.length) throw new Error("تعذر التحقق من اكتمال بيانات الحساب.");

      const profile = profileResult.data;
      const roles = rolesResult.data || [];
      if (!profile || profile.id !== newUserId || profile.email?.toLowerCase() !== email ||
          profile.name !== name || roles.length !== 1 || roles[0]?.role !== role ||
          walletResult.data?.user_id !== newUserId) {
        throw new Error("لم تتطابق بيانات الملف الشخصي أو الدور أو المحفظة مع الحساب المطلوب.");
      }

      setupComplete = true;
      return json({
        success: true,
        verified: true,
        user: { id: newUserId, email, name, role },
      }, 200, cors);
    } catch (setupFailure) {
      const reason = setupFailure instanceof Error ? setupFailure.message : "فشل إعداد الحساب.";
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(newUserId, false);
      if (cleanupError) {
        console.error("admin-create-user compensation failed", {
          userId: newUserId,
          setupFailure: reason,
          cleanupFailure: cleanupError.message,
        });
        return json({
          error: "تعذر إكمال إعداد الحساب كما تعذر التراجع الآمن عن حساب المصادقة. أوقفنا العملية للمراجعة الإدارية.",
          cleanupRequired: true,
        }, 502, cors);
      }
      return json({ error: reason + " تم التراجع عن إنشاء حساب المصادقة." }, 422, cors);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف.";
    console.error("admin-create-user failed:", message);
    return json({ error: "تعذر تنفيذ إنشاء الحساب بأمان." }, 500, cors);
  }
});
