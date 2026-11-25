# Windows encrypted offline downloads

## Scope and isolation

This is a Windows desktop-only feature. It uses the existing local yt-dlp extraction path and formats already selected by the ED-ALL desktop player. It does not load Piped or Invidious, and it does not change browser, Android/NewPipe, or existing desktop online playback paths.

## Storage design

- Each video/audio track is stored as independently authenticated AES-256-GCM chunks.
- The encryption key is wrapped through Electron's asynchronous safeStorage API when available (with compatibility for older synchronous Electron versions). On Windows this delegates key protection to Windows user-account protection (DPAPI).
- If OS-backed secure key storage is unavailable, the feature fails closed. It never falls back to an unencrypted download. The feature is disabled outside Windows rather than accepting a weaker key-storage backend.
- No plaintext temporary media file is created. Plaintext exists only in bounded in-memory chunks while the encrypted file is written or read.
- The offline manifest, including the wrapped key, chunk index, and verified ED-ALL user ID, is protected with safeStorage.
- Listing, playback, and deletion require the same ED-ALL user ID stored in the encrypted manifest. A different signed-in account cannot see, play, or delete those items through the application.
- The last server-verified ED-ALL account ID is itself encrypted with safeStorage so the same Windows profile can open its offline library when disconnected. The bearer token is never persisted by the desktop vault.
- Media playback supports HTTP byte ranges. A chunk is fully authenticated before any bytes from that chunk are returned.
- Deleting an item removes the manifest (which holds the wrapped key) and encrypted files. Secure physical erasure is not guaranteed on SSDs or journaled filesystems.

## User flow

1. Open a lesson in the Windows EdAll desktop program.
2. Select a quality in the existing player and choose **Save encrypted offline**.
3. The desktop app downloads the existing yt-dlp stream, encrypts it, and stores it under the app's user-data directory.
4. Open **Saved downloads** under the desktop player to view, play, or delete saved lessons. The library is account-scoped; switching accounts changes which encrypted manifests can be listed.
5. After the first online sign-in and account verification, the same Windows profile can reopen that account's encrypted library while offline. A new offline download still requires a live server authorization check.

## Security boundary and limitations

This is encryption at rest plus a server-side authorization gate for each new download, not an unbreakable DRM system. The main process sends the current signed-in user's bearer token to the dedicated ED-ALL authorization Edge Function. The function uses that JWT and the existing lesson/video Row Level Security rules to confirm that the account may access the exact course, lesson, and YouTube video before yt-dlp starts. The returned user ID is checked and bound into the encrypted manifest. No service-role key is used, and the access token is not written to disk or included in the manifest.

A user who controls the same Windows account and can instrument the running application may ultimately capture media while it is being decrypted for playback. Already-downloaded files remain available to the last verified account on that same Windows profile while offline; this is local account scoping, not a renewable server license or guaranteed revocation while the device is disconnected. It does not provide an unbreakable DRM system.

The main process accepts requests only from the platform's main frame, and only saves a stream token already registered by the existing yt-dlp playback path. Before downloading, it validates the signed-in account against Supabase Auth and calls the ED-ALL authorization function with the course, lesson, and video identifiers. The local library page is the only additional local file page allowed by navigation policy. Stream URLs, request headers, bearer tokens, and publishable keys are not persisted in the offline manifest. The remembered account ID is stored separately using OS-backed safeStorage.

## Validation

The **Windows encrypted offline media vault** workflow runs Node syntax checks and unit tests for:
- encrypted round-trip and plaintext absence,
- authenticated chunk integrity/tamper rejection,
- byte-range reads,
- OS key-storage unavailable fail-closed behavior,
- video/audio library save, list, playback and delete operations,
- rejection of malformed IDs and non-success provider responses,
- account A cannot list, play, or delete account B's encrypted media,
- the remembered account ID is encrypted and can be cleared on logout,
- server authorization is checked before media extraction starts,
- account sync uses a verified Supabase Auth identity and rejects stale sync messages.

A Windows packaging/playback smoke test on a real Windows install is still required before release.