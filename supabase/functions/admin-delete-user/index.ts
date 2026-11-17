import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isDefinitivelyMissingAuthUser } from "../_shared/delete-user-verification.ts";
import { edallCorsHeaders, isAllowedEdallOrigin } from "../_shared/app-origin.ts";

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const cors = edallCorsHeaders(origin, supabaseUrl);
  const originAllowed = isAllowedEdallOrigin(origin, supabaseUrl);
  const respond = (body: Record<string, unknown>, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") {
    if (!originAllowed) return respond({ error: "Origin is not allowed for this backend." }, 403);
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  if (!originAllowed) return respond({ error: "Origin is not allowed for this backend." }, 403);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ error: "يجب تسجيل الدخول بصلاحية مدير." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    let publishableKey: string | undefined;
    try {
      const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.default === "string" && parsed.default) publishableKey = parsed.default;
    } catch {
      publishableKey = undefined;
    }
    publishableKey = publishableKey || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return respond({ error: "إعدادات خدمة حذف الحساب غير مكتملة." }, 500);
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    const caller = callerData?.user;
    if (callerError || !caller) return respond({ error: "الجلسة غير صالحة أو انتهت." }, 401);

    const { data: isAdmin, error: roleCheckError } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (roleCheckError || isAdmin !== true) {
      return respond({ error: "حذف حسابات المنصة متاح للمدير فقط." }, 403);
    }

    const { data: adminMfaVerified, error: mfaError } = await callerClient.rpc("admin_mfa_verified");
    if (mfaError || adminMfaVerified !== true) {
      return respond({ error: "يجب تأكيد المصادقة الثنائية (AAL2) قبل حذف الحسابات." }, 403);
    }

    let body: { user_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return respond({ error: "بيانات الطلب غير صالحة." }, 400);
    }
    const targetId = String(body?.user_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
      return respond({ error: "معرف المستخدم غير صحيح." }, 400);
    }
    if (targetId === caller.id) {
      return respond({ error: "لا يمكن حذف حساب المدير الذي يستخدم المساعد حاليًا." }, 400);
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
      paymentOrdersResult,
      certificatesResult,
      assignmentSubmissionsResult,
      examResultsResult,
      attendanceRecordsResult,
      discussionTopicsResult,
      discussionPostsResult,
      authUserResult,
    ] = await Promise.all([
      adminClient.from("profiles").select("id,name,email").eq("id", targetId).maybeSingle(),
      adminClient.from("user_roles").select("role").eq("user_id", targetId),
      adminClient.from("courses").select("id,title").eq("created_by", targetId).limit(1),
      adminClient.from("wallets").select("balance").eq("user_id", targetId).maybeSingle(),
      adminClient.from("wallet_transactions").select("id").eq("user_id", targetId).limit(1),
      adminClient.from("wallet_transactions").select("id").eq("created_by", targetId).limit(1),
      adminClient.from("payment_orders").select("id").eq("user_id", targetId).limit(1),
      adminClient.from("course_certificates").select("id").eq("student_id", targetId).limit(1),
      adminClient.from("assignment_submissions").select("id").eq("student_id", targetId).limit(1),
      adminClient.from("exam_results").select("exam_id").eq("user_id", targetId).limit(1),
      adminClient.from("attendance_records").select("id").eq("student_id", targetId).limit(1),
      adminClient.from("discussion_topics").select("id").eq("author_id", targetId).limit(1),
      adminClient.from("discussion_posts").select("id").eq("author_id", targetId).limit(1),
      adminClient.auth.admin.getUserById(targetId),
    ]);

    const lookupErrors = [
      profileResult.error,
      rolesResult.error,
      ownedCoursesResult.error,
      walletResult.error,
      userTransactionsResult.error,
      createdTransactionsResult.error,
      paymentOrdersResult.error,
      certificatesResult.error,
      assignmentSubmissionsResult.error,
      examResultsResult.error,
      attendanceRecordsResult.error,
      discussionTopicsResult.error,
      discussionPostsResult.error,
      authUserResult.error,
    ].filter(Boolean);
    if (lookupErrors.length) {
      return respond({ error: "تعذر فحص ارتباطات الحساب وسجلاته قبل الحذف." }, 502);
    }

    const profile = profileResult.data;
    if (!profile || !authUserResult.data?.user) {
      return respond({ error: "لم يتم العثور على حساب مستخدم نشط بهذا المعرف." }, 404);
    }

    const targetRoles = (rolesResult.data || []).map((row) => row.role);
    if (targetRoles.includes("admin")) {
      return respond({ error: "الحذف المباشر لحسابات المديرين ممنوع لحماية إدارة المنصة." }, 403);
    }

    const ownedCourse = (ownedCoursesResult.data || [])[0];
    if (ownedCourse) {
      return respond({
        error: "لا يمكن حذف هذا الحساب؛ لأنه يملك دورة باسم «" + String(ownedCourse.title || "بدون عنوان").slice(0, 120) + "». انقل ملكية الدورة أو عالجها أولًا.",
      }, 409);
    }

    const balance = Number(walletResult.data?.balance || 0);
    if (!Number.isFinite(balance) || Math.abs(balance) > 0.000001) {
      return respond({ error: "لا يمكن حذف الحساب؛ لأن محفظته لا تزال تحتوي على رصيد. صفّر الرصيد أو سوِّه أولًا." }, 409);
    }
    if ((userTransactionsResult.data || []).length || (createdTransactionsResult.data || []).length) {
      return respond({ error: "لا يمكن حذف الحساب؛ لوجود سجل معاملات مالية مرتبط به. احتفظ بسجل التدقيق المالي." }, 409);
    }

    if ((paymentOrdersResult.data || []).length) {
      return respond({ error: "لا يمكن حذف الحساب؛ لأنه مرتبط بطلب دفع. يجب الاحتفاظ بسجل المدفوعات لأغراض المراجعة والمحاسبة." }, 409);
    }
    if ((certificatesResult.data || []).length) {
      return respond({ error: "لا يمكن حذف الحساب؛ لأنه يملك شهادات صادرة يجب أن تظل قابلة للتحقق." }, 409);
    }
    if (
      (assignmentSubmissionsResult.data || []).length ||
      (examResultsResult.data || []).length ||
      (attendanceRecordsResult.data || []).length ||
      (discussionTopicsResult.data || []).length ||
      (discussionPostsResult.data || []).length
    ) {
      return respond({ error: "لا يمكن حذف الحساب مباشرة؛ لأنه يحتوي على سجلات تعليمية. استخدم إيقاف الحساب أو اطلب معالجة تحفظ السجلات أولاً." }, 409);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId, false);
    if (deleteError) {
      return respond({ error: "تعذر حذف حساب المصادقة: " + deleteError.message.slice(0, 220) }, 502);
    }

    const [profileCheck, rolesCheck, authCheck] = await Promise.all([
      adminClient.from("profiles").select("id").eq("id", targetId).maybeSingle(),
      adminClient.from("user_roles").select("id").eq("user_id", targetId).limit(1),
      adminClient.auth.admin.getUserById(targetId),
    ]);
    if (profileCheck.error || rolesCheck.error) {
      return respond({ error: "تم إرسال أمر الحذف، لكن تعذر إكمال التحقق من سجلات الحساب." }, 502);
    }
    const authCheckAcceptedAsGone = isDefinitivelyMissingAuthUser(authCheck);
    if (!authCheckAcceptedAsGone) {
      return respond({ error: "تم إرسال أمر الحذف، لكن لم يكتمل التحقق من اختفاء حساب المصادقة." }, 502);
    }
    if (profileCheck.data || (rolesCheck.data || []).length || authCheck.data?.user) {
      return respond({ error: "لم يختفِ الحساب بالكامل بعد الحذف؛ لم أعتبر العملية مكتملة." }, 502);
    }

    let warning: string | undefined;
    const { error: notificationCleanupError } = await adminClient
      .from("notifications")
      .delete()
      .eq("user_id", targetId);
    if (notificationCleanupError) {
      warning = "تم حذف الحساب والتحقق منه، لكن تعذر تنظيف بعض الإشعارات القديمة.";
    }

    return respond({
      success: true,
      deleted: true,
      verified: true,
      user: { id: targetId, name: profile.name, email: profile.email },
      warning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ غير معروف.";
    return respond({ error: "تعذر تنفيذ حذف الحساب بأمان: " + message.slice(0, 220) }, 500);
  }
});
