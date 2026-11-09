import test from "node:test";
import assert from "node:assert/strict";
import { canUseAssistantTool } from "./index.js";

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

test("students receive only their own self-service and learning tools", () => {
  for (const name of [
    "list_courses", "get_course_lessons", "purchase_course", "list_favorites",
    "manage_favorite", "manage_notifications_bulk", "upload_profile_avatar",
    "update_user_profile", "send_password_reset", "get_wallet_info",
    "list_notifications", "mark_notification_read", "delete_notification"
  ]) assert.equal(canUseAssistantTool(name, {}, ["student"], ownId), true, name);

  for (const name of [
    "get_platform_stats", "search_platform_users", "create_course", "create_lesson",
    "create_exam", "list_course_students", "get_student_progress", "grade_essay_result",
    "credit_user_wallet", "change_user_role", "set_user_ban", "list_platform_settings",
    "manage_topup_contact", "send_notification"
  ]) assert.equal(canUseAssistantTool(name, {}, ["student"], ownId), false, name);
});

test("teachers and students cannot target another account with self-service tools", () => {
  for (const role of ["student", "teacher"]) {
    for (const name of ["send_password_reset", "update_user_profile", "get_wallet_info", "list_favorites"]) {
      assert.equal(canUseAssistantTool(name, { user_id: otherId }, [role], ownId), false);
      assert.equal(canUseAssistantTool(name, { user_id: ownId }, [role], ownId), true);
      assert.equal(canUseAssistantTool(name, {}, [role], ownId), true);
    }
  }
});

test("accounts without a valid platform role receive no tools", () => {
  assert.equal(canUseAssistantTool("list_courses", {}, [], ownId), false);
  assert.equal(canUseAssistantTool("list_courses", {}, ["guest"], ownId), false);
});
