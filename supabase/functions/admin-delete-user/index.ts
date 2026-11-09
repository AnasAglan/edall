import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://edall.lovable.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "يجب تسجيل الدخول بصلاحية مدير." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return json({ error: "إعدادات خدمة حذف الحساب غير مكتملة." }, 500);
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    const caller = callerData?.user;
    if (callerError || !caller) return json({ error: "الجلسة غير صالحة أو انتهت." }, 401);

    const { data: isAdmin, error: roleCheckError } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (roleCheckError || isAdmin !== true) {
      return json({ error: "حذف حسابات المنصة متاح للمدير فقط." }, 403);
    }

    let body: { user_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "بيانات الطلب غير صالحة." }, 400);
    }
    const targetId = String(body?.user_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
      return json({ error: "معرف المستخدم غير صحيح." }, 400);
    }
    if (targetId === caller.id) {
      return json({ error: "لا يمكن حذف حساب المدير الذي يستخدم المساعد حاليًا." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [
      profileResult,
      rolesResult,
      ownedCoursesResult,
      walletResult,
      userTransactionsResult,
      createdTransactionsResult,
      authUserResult,
    ] = await Promise.all([
      adminClient.from("profiles").select("id,name,email").eq("id", targetId).maybeSingle(),
      adminClient.from("user_roles").select("role").eq("user_id", targetId),
      adminClient.from("courses").select("id,title").eq("created_by", targetId).limit(1),
      adminClient.from("wallets").select("balance").eq("user_id", targetId).maybeSingle(),
      adminClient.from("wallet_transactions").select("id").eq("user_id", targetId).limit(1),
      adminClient.from("wallet_transactions").select("id").eq("created_by", targetId).limit(1),
      adminClient.auth.admin.getUserById(targetId),
    ]);

    const lookupErrors = [
      profileResult.error,
      rolesResult.error,
      ownedCoursesResult.error,
      walletResult.error,
      userTransactionsResult.error,
      createdTransactionsResult.error,
      authUserResult.error,
    ].filter(Boolean);
    if (lookupErrors.length) {
      return json({ error: "تعذر فحص ارتباطات الحساب وسجلاته قبل الحذف." }, 502);
    }

    const profile = profileResult.data;
    if (!profile || !authUserResult.data?.user) {
      return json({ error: "لم يتم العثور على حساب مستخدم نشط بهذا المعرف." }, 404);
    }

    const targetRoles = (rolesResult.data || []).map((row) => row.role);
    if (targetRoles.includes("admin")) {
      return json({ error: "الحذف المباشر لحسابات المديرين ممنوع لحماية إدارة المنصة." }, 403);
    }

    const ownedCourse = (ownedCoursesResult.data || [])[0];
    if (ownedCourse) {
      return json({
        error: "لا يمكن حذف هذا الحساب؛ لأنه يملك دورة باسم «" + String(ownedCourse.title || "بدون عنوان").slice(0, 120) + "». انقل ملكية الدورة أو عالجها أولًا.",
      }, 409);
    }

    const balance = Number(walletResult.data?.balance || 0);
    if (!Number.isFinite(balance) || Math.abs(balance) > 0.000001) {
      return json({ error: "لا يمكن حذف الحساب؛ لأن محفظته لا تزال تحتوي على رصيد. صفّر الرصيد أو سوِّه أولًا." }, 409);
    }
    if ((userTransactionsResult.data || []).length || (createdTransactionsResult.data || []).length) {
      return json({ error: "لا يمكن حذف الحساب؛ لوجود سجل معاملات مالية مرتبط به. احتفظ بسجل التدقيق المالي." }, 409);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId, false);
    if (deleteError) {
      return json({ error: "تعذر حذف حساب المصادقة: " + deleteError.message.slice(0, 220) }, 502);
    }

    const [profileCheck, rolesCheck, authCheck] = await Promise.all([
      adminClient.from("profiles").select("id").eq("id", targetId).maybeSingle(),
      adminClient.from("user_roles").select("id").eq("user_id", targetId).limit(1),
      adminClient.auth.admin.getUserById(targetId),
    ]);
    if (profileCheck.error || rolesCheck.error) {
      return json({ error: "تم إرسال أمر الحذف، لكن تعذر إكمال التحقق من سجلات الحساب." }, 502);
    }
    if (profileCheck.data || (rolesCheck.data || []).length || authCheck.data?.user) {
      return json({ error: "لم يختفِ الحساب بالكامل بعد الحذف؛ لم أعتبر العملية مكتملة." }, 502);
    }

    let warning: string | undefined;
    const { error: notificationCleanupError } = await adminClient
      .from("notifications")
      .delete()
      .eq("user_id", targetId);
    if (notificationCleanupError) {
      warning = "تم حذف الحساب والتحقق منه، لكن تعذر تنظيف بعض الإشعارات القديمة.";
    }

    return json({
      success: true,
      deleted: true,
      verified: true,
      user: { id: targetId, name: profile.name, email: profile.email },
      warning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف.";
    return json({ error: "تعذر تنفيذ حذف الحساب بأمان: " + message.slice(0, 220) }, 500);
  }
});
