import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  canUseAssistantTool,
  canAccessAssistant,
  shouldForceInScope,
  inferRequiredReadTools,
  buildScopeRouting,
  attachUserRoles
} from "./index.js";

const ownId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

test("admins can use known tools but unknown tool names are denied", () => {
  assert.equal(canUseAssistantTool("get_platform_stats", {}, ["admin"], ownId), true);
  assert.equal(canUseAssistantTool("credit_user_wallet", { user_id: otherId }, ["admin"], ownId), true);
  assert.equal(canUseAssistantTool("unlisted_admin_tool", {}, ["admin"], ownId), false);
});

test("teachers can manage teaching workflows but not global administration", () => {
  assert.equal(canUseAssistantTool("create_course", {}, ["teacher"], ownId), true);
  assert.equal(canUseAssistantTool("get_student_progress", {}, ["teacher"], ownId), true);
  assert.equal(canUseAssistantTool("get_platform_stats", {}, ["teacher"], ownId), false);
  assert.equal(canUseAssistantTool("search_platform_users", {}, ["teacher"], ownId), false);
  assert.equal(canUseAssistantTool("credit_user_wallet", { user_id: otherId }, ["teacher"], ownId), false);
  assert.equal(canUseAssistantTool("send_notification", {}, ["teacher"], ownId), false);
  assert.equal(canUseAssistantTool("remove_course_enrollment", { user_id: otherId }, ["teacher"], ownId), false);
});

test("students are denied every assistant tool", () => {
  for (const name of [
    "list_courses", "get_course_lessons", "purchase_course", "list_favorites",
    "get_wallet_info", "list_notifications", "get_platform_stats", "create_course"
  ]) assert.equal(canUseAssistantTool(name, {}, ["student"], ownId), false, name);
  assert.equal(canAccessAssistant(["student"]), false);
  assert.equal(canAccessAssistant(["teacher"]), true);
  assert.equal(canAccessAssistant(["admin"]), true);
  assert.equal(canAccessAssistant(["student", "teacher"]), true);
});

test("teachers cannot target another account with self-service tools", () => {
  for (const name of ["send_password_reset", "update_user_profile", "get_wallet_info", "list_favorites"]) {
    assert.equal(canUseAssistantTool(name, { user_id: otherId }, ["teacher"], ownId), false);
  }
});

async function callWorkerAs(roles) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: ownId }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/rest/v1/user_roles")) return new Response(JSON.stringify(roles.map(role => ({ role }))), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("unexpected upstream call: " + url);
  };
  try {
    const res = await worker.fetch(new Request("https://edall-assistant.example/", {
      method: "POST",
      headers: { Origin: "https://edall.lovable.app", Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] })
    }), { SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "k", GEMINI_API_KEY: "g", AI: { run() { throw new Error("model must not run"); } } });
    return { res, calls };
  } finally { globalThis.fetch = realFetch; }
}

test("worker rejects a student request with 403 before any model or tool call", async () => {
  const { res, calls } = await callWorkerAs(["student"]);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 2);
  assert.ok(!calls.some(u => /gemini|googleapis/i.test(u)));
});

test("accounts without a valid platform role receive no tools", () => {
  assert.equal(canUseAssistantTool("list_courses", {}, [], ownId), false);
  assert.equal(canUseAssistantTool("list_courses", {}, ["guest"], ownId), false);
});


test("Arabic platform topics always stay in scope without depending on the classifier", () => {
  for (const text of [
    "الفيديوهات لسه مش شغالة بالجودات",
    "أمر التطبيق فقط لا يعمل على الموقع",
    "لماذا المساعد يخترع أسماء كورسات؟",
    "احذف المستخدم من لوحة الإدارة",
    "كيف أصلح قاعدة بيانات ED-ALL؟",
    "الموقع يفتح الفيديو بجودة تلقائية"
  ]) {
    assert.equal(shouldForceInScope([{ role: "user", content: text }]), true, text);
  }
});

test("short Arabic follow-ups inherit recent ED-ALL context", () => {
  assert.equal(shouldForceInScope([
    { role: "user", content: "اعرض لي الكورسات الموجودة في ED-ALL" },
    { role: "assistant", content: "هذه قائمة الدورات..." },
    { role: "user", content: "طيب دي لسه مش شغالة" }
  ]), true);
  assert.equal(shouldForceInScope([
    { role: "user", content: "How do I add a course to ED-ALL?" },
    { role: "assistant", content: "..." },
    { role: "user", content: "same issue" }
  ]), true);
});

test("independent questions without platform context remain eligible for out-of-scope classification", () => {
  assert.equal(shouldForceInScope([
    { role: "user", content: "ما عاصمة فرنسا؟" }
  ]), false);
});

test("course and lesson data questions force an actual course database read", () => {
  const result = inferRequiredReadTools([
    { role: "user", content: "ما أسماء الكورسات الموجودة عندنا؟" }
  ], ["admin"]);
  assert.deepEqual(result, [{ name: "list_courses", args: { limit: 50 } }]);
});

test("admin questions about accounts force a real account search", () => {
  const result = inferRequiredReadTools([
    { role: "user", content: "اعرض أسماء المستخدمين الموجودين" }
  ], ["admin"]);
  assert.deepEqual(result, [{ name: "search_platform_users", args: { query: "", limit: 50, offset: 0 } }]);
});

test("read routing never grants account search to teachers or turns writes into reads", () => {
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "اعرض المستخدمين" }
  ], ["teacher"]), []);
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "أضف دورة جديدة" }
  ], ["admin"]), []);
});

test("independent general questions are answered normally without ED-ALL tool access", () => {
  const route = buildScopeRouting("OUT_OF_SCOPE");
  assert.equal(route.allowPlatformTools, false);
  assert.match(route.instruction, /أجب عنه مباشرة/);
  assert.match(route.instruction, /لا تستخدم أدوات المنصة/);
  assert.doesNotMatch(route.instruction, /ما المهمة التي تريد تنفيذها داخل المنصة/);
});

test("ED-ALL questions retain platform tools and anti-hallucination grounding", () => {
  const route = buildScopeRouting("IN_SCOPE");
  assert.equal(route.allowPlatformTools, true);
  assert.match(route.instruction, /لا تخترع/);
  assert.match(route.instruction, /نتائج الأدوات فقط/);
});

test("Arabic Egyptian phrasing routes course, teacher, and lesson questions to database reads", () => {
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "عندنا اي كورسات؟" }
  ], ["admin"]), [{ name: "list_courses", args: { limit: 50 } }]);

  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "مين المدرسين؟" }
  ], ["admin"]), [{ name: "search_platform_users", args: { query: "", limit: 50, offset: 0, role: "teacher" } }]);

  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "في كام درس؟" }
  ], ["admin"]), [{ name: "get_platform_stats", args: {} }]);

  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "في كام درس؟" }
  ], ["teacher"]), [{ name: "list_courses", args: { limit: 50 } }]);
});

test("generic list follow-ups inherit the previous platform entity", () => {
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "عندنا اي كورسات؟" },
    { role: "assistant", content: "سأبحث في الدورات." },
    { role: "user", content: "وريني اللي موجود" }
  ], ["admin"]), [{ name: "list_courses", args: { limit: 50 } }]);
});

test("platform statistics phrases always force verified reads for administrators", () => {
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "إحصائيات المنصة" }
  ], ["admin"]), [{ name: "get_platform_stats", args: {} }]);
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "احصائيات المنصة" }
  ], ["admin"]), [{ name: "get_platform_stats", args: {} }]);
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "إحصائيات المنصة" }
  ], ["teacher"]), []);
});

test("teacher/student/admin directory requests are filtered by actual role", () => {
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "مين المدرسين؟" }
  ], ["admin"]), [{ name: "search_platform_users", args: { query: "", limit: 50, offset: 0, role: "teacher" } }]);
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "مين الطلاب؟" }
  ], ["admin"]), [{ name: "search_platform_users", args: { query: "", limit: 50, offset: 0, role: "student" } }]);
  assert.deepEqual(inferRequiredReadTools([
    { role: "user", content: "اعرض المديرين" }
  ], ["admin"]), [{ name: "search_platform_users", args: { query: "", limit: 50, offset: 0, role: "admin" } }]);
});

test("user role labels are attached only from valid database role rows", () => {
  const rows = attachUserRoles([
    { id: ownId, name: "Teacher", email: "teacher@example.test", public_id: "T1" },
    { id: otherId, name: "Student", email: "student@example.test", public_id: "S1" }
  ], [
    { user_id: ownId, role: "teacher" },
    { user_id: ownId, role: "admin" },
    { user_id: otherId, role: "student" },
    { user_id: otherId, role: "unknown" },
    { user_id: "not-a-uuid", role: "teacher" }
  ]);
  assert.deepEqual(rows, [
    { id: ownId, name: "Teacher", email: "teacher@example.test", public_id: "T1", roles: ["teacher", "admin"] },
    { id: otherId, name: "Student", email: "student@example.test", public_id: "S1", roles: ["student"] }
  ]);
});
