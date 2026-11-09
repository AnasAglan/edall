# ED-ALL Assistant Worker

Cloudflare Worker backing the ED-ALL teacher/admin assistant.

## Existing bindings
- `GEMINI_API_KEY`: required encrypted secret used for primary Gemini 2.5 Flash inference. Never commit or log its value.
- `AI`: Cloudflare Workers AI fallback for Gemini request failures.
- `SUPABASE_PUBLISHABLE_KEY`: existing secret binding. Never commit a value.
- Supabase project URL is the existing ED-ALL project.

## Deployment notes
The deployed Worker is `edall-assistant`. When uploading a new version, preserve all existing bindings (`AI`, `GEMINI_API_KEY`, and `SUPABASE_PUBLISHABLE_KEY`). Do not replace secret values, disable auth, use a service-role key, or bypass Supabase RLS.

## Capabilities
- List courses and inspect courses owned by the current teacher or any course as admin.
- Create courses and lessons, including video URLs and pre-existing public PDF URLs.
- Create lesson exams and multiple-choice / essay questions.
- Admin-only platform statistics and user search.
- Teacher/admin notifications.

All data operations use the signed-in user's Supabase JWT. Global user statistics and user search are admin-only. There are deliberately no arbitrary SQL, role, balance, ban, or delete tools.

PDF links are references to files already available at public URLs; the chat does not upload local PDF binaries.
