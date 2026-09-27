import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCoursesTool from "./tools/list-courses";
import myEnrollmentsTool from "./tools/my-enrollments";
import walletBalanceTool from "./tools/wallet-balance";
import myNotificationsTool from "./tools/my-notifications";
import listLessonsTool from "./tools/list-lessons";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "ed-all-mcp",
  title: "ED ALL",
  version: "0.1.0",
  instructions:
    "Tools for the ED ALL learning platform. Browse courses, list your enrollments, check wallet balance and transactions, list your notifications, and list the lessons of a course. All tools act as the signed-in user; RLS enforces per-user access.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listCoursesTool, myEnrollmentsTool, walletBalanceTool, myNotificationsTool, listLessonsTool],
});
