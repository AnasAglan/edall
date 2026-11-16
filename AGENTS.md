# Architecture
- Keep all platform UI and playback logic in `public/ed_master.html`; Electron's OS-only shell is isolated in `electron/` because native process execution cannot run in a browser.
- Bundle a complete platform snapshot and serve it under the published origin through Electron's HTTPS handler, preserving origin-based authentication and using a compatible hosted snapshot for startup updates.
- Expose narrowly validated extraction IPC only to the platform's main frame; never expose arbitrary commands or filesystem access.
- Keep yt-dlp writable in per-user application data and update via its own verified release updater; keep bundled binaries as fallback.
- Package desktop distributions with NSIS outside the source tree; a single installer EXE extracts required runtime files rather than claiming Electron executes as one unpacked file.

<!-- AGENT-MEMORY:BEGIN -->
- Supply the monolithic public HTML with a blocking, Vite-served/emitted config asset validated against the staging project allowlist; public HTML is not transformed by Vite and must never embed backend credentials or fall back to production.
- Keep Staging assistant, extractor and media-proxy Workers on separate names/configs with an exact Staging origin/backend allowlist; preserve production Worker defaults.
- Validate assistant backend configuration before upstream calls and use staging-named Worker secrets; never let Staging fall back to production credentials or endpoints.
<!-- AGENT-MEMORY:END -->