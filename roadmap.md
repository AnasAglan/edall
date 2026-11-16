# Staging (PR #42, branch security/edall-hardening-and-feature-suite @ 7b80168)
- [x] Sync branch code (82 files) into this remix project without touching the original repo.
- [x] Apply the 19 branch migrations to this project's own backend only.
- [x] Configure storage buckets (lesson-pdfs private 25MB, assignment-submissions private 20MB).
- [x] Deploy edge functions (create-payment-intention, paymob-webhook, admin-create-user, admin-delete-user).
- [x] Regenerate DB types; 121/121 tests pass; preview build OK.
- [x] Link Google Search Console connection to this project.
- [ ] Payment provider secrets (Paymob) — disabled by default; needs user's provider credentials to test checkout.
- [ ] Create/review/deploy the isolated assistant Worker manually in the user's Cloudflare account with STAGING_SUPABASE_PUBLISHABLE_KEY; STAGING_GEMINI_API_KEY is optional. No deployment authorized in this step.

# Staging isolation
- [x] Replace embedded browser Supabase credentials with a fail-closed Staging config asset and the exact Remix backend URL.
- [x] Route Staging playback and assistant calls to separately named Staging Workers; production Worker configs retain production defaults.
- [x] Add origin/backend isolation regression tests and a Staging-only build/test workflow.
- [ ] Verify the rebuilt Lovable preview in a browser and provision the three Staging Workers (separate approval required; no deployment performed here).
- [ ] Review the complete diff and report files and remaining manual Worker setup.

# Windows desktop
- [x] Single Windows installer EXE with icon, platform, yt-dlp and runtime.
- [x] External browser for PDFs/other sites; offline screen with restart button.
- [x] Website asks browsers to install the app instead of showing YouTube videos.
- [ ] Host the installer and set the real download link (needs the user's hosting, e.g. GitHub Releases).
- [ ] Code-signing certificate (needs the user to buy one, e.g. Azure Trusted Signing / OV certificate).
- [ ] Test on a real Windows machine.