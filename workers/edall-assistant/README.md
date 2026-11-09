# ED-ALL Assistant Worker

Cloudflare Worker backing the ED-ALL teacher/admin assistant.

## AI providers and shared context

- **Primary: Cloudflare Workers AI.** Text requests and tool-calling use `@cf/zai-org/glm-4.7-flash`; image streams use `@cf/meta/llama-3.2-11b-vision-instruct`.
- **Fallback: Gemini 3.8 Flash.** If the Workers AI binding is missing, exhausted, rate-limited, out of capacity, times out, or returns an empty, reasoning-only, or invalid response, the Worker retries that same model operation through Gemini using `GEMINI_API_KEY`.
- Both providers receive the same system prompt, conversation messages, tool definitions, and accumulated assistant/tool-call results. Conversation history is stored in the existing owner-scoped Supabase tables and the Worker retrieves the most recent 40 messages for a conversation.
- Gemini is not called when Workers AI succeeds. The Gemini secret is required for automatic fallback; Workers AI can still be used independently when the secret is absent.

## Existing bindings

- `AI`: Cloudflare Workers AI binding.
- `GEMINI_API_KEY`: encrypted fallback-provider secret. Never commit or log its value.
- `SUPABASE_PUBLISHABLE_KEY`: existing Supabase publishable key secret. Never commit its value.
- Supabase project URL is the existing ED-ALL project.

## Platform capabilities

The assistant currently exposes 46 allowlisted tools with explicit server-side handlers, covering:

- Courses: list, create, update (including price), and delete.
- Lessons and media: list, create, update, delete, manage video/PDF links, and upload course-cover images from supported image attachments.
- Exams and questions: list, create, update, delete, manage multiple-choice and essay questions, retrieve grading submissions, and grade essay answers.
- Students and enrolments: list course students, read course progress, and administer enrolment removal.
- Users and accounts: admin search, create accounts, safe password-reset links, profile updates, ban/unban, role changes, and guarded account deletion.
- Wallets and commerce: read balances and transactions, purchase/enrol through the official purchase RPC, and admin wallet crediting.
- Platform operations: statistics, site settings, notifications, and wallet top-up contacts.
- Personal actions: favorites, profile avatars, and notification management.

## Safety and current limits

- All normal data operations use the signed-in user's Supabase JWT and retain Supabase RLS. Admin-only and teacher/admin actions are checked in the Worker; teachers are scoped to courses they own.
- Writes are allowlisted, validated, and read back to verify persistence. Purchases, wallet changes, deletions, bans, role changes, and other sensitive actions require explicit confirmation.
- The assistant never receives passwords and does not execute arbitrary SQL.
- Course images and profile avatars can be uploaded from supported image attachments. Video and PDF media management currently manages existing public URLs; it does not upload raw video/PDF files from the user's device.
- Some internal tables (such as unsent exam drafts) are intentionally not exposed as general administration tools. The assistant does not bypass permissions or reveal private drafts.
- A model response is not evidence of a successful write: the relevant tool must return a verified result.

## Deployment notes

The deployed Worker is `edall-assistant`. When uploading a new version, preserve all existing bindings (`AI`, `GEMINI_API_KEY`, and `SUPABASE_PUBLISHABLE_KEY`). Do not replace secret values, disable authentication, use a service-role key, or bypass Supabase RLS.
