# Android offline-download authorization: native integration contract

## Current scope

This branch adds only the server-side authorization gate and a web UI integration point. It does **not** contain Android application source code, NewPipe integration code, Android Keystore storage, an encrypted media cache, or native playback changes. The Android feature must therefore remain hidden until a compatible native bridge is included in the Android application.

The authorization Edge Function uses the signed-in user's JWT and the existing Supabase Row Level Security policies to verify:
- the caller's session is valid;
- the requested lesson belongs to the requested course and is accessible under the current RLS rules;
- web playback is enabled for the lesson;
- the exact requested YouTube video ID is attached to that lesson.

It returns only an authorization result and identifiers. It does not return an extraction URL, download a video, or bypass NewPipe.

## Expected Android bridge contract

The web UI displays the offline controls only when the Android WebView bridge provides all of these capabilities:

- `isAndroid === true`
- `downloadOfflineVideo(videoId, quality, courseId, lessonId, accessToken, supabaseUrl, supabaseAnonKey)`
- `openOfflineLibrary()`

The native method must call `authorize-offline-download` with the user's current bearer token before it downloads. It must reject expired sessions and re-check course/lesson/video access for every new download. Do not store or log the bearer token.

## Required native security and implementation work

Before declaring Android downloads complete:
1. Use the existing NewPipe extractor/library only. Do not route Android through Piped, Invidious or yt-dlp.
2. Protect each offline file key with Android Keystore; use authenticated AES-GCM encryption and verify a complete encrypted chunk before returning any decrypted bytes to playback.
3. Never write a plaintext video or audio temporary file. Fail closed if Android Keystore is unavailable.
4. Keep private media files inside app-private storage; do not expose raw media or permanent extraction URLs through intents, shared storage, logs, or web storage.
5. Add an offline library UI with list, play, delete, corruption handling, and storage-quota management.
6. Bind downloaded items to the signed-in account and re-check entitlement according to the product's offline-access policy. A local encryption key alone is not a server entitlement or an unbreakable DRM system.
7. Add Android instrumentation tests for Keystore unavailable, key rotation/reinstall, tampered chunks, interrupted downloads, playback seeking/range reads, app logout/account changes, and NewPipe extraction failure.
8. Test on the minimum supported Android version and a modern Android release before enabling the button for users.

Until those steps are completed in the Android source repository, this PR remains a backend authorization foundation only; it must not be described as an end-to-end Android encrypted-download implementation.
