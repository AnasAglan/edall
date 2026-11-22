# Windows encrypted offline downloads

## Scope and isolation

This is a Windows desktop-only feature. It uses the existing local yt-dlp extraction path and formats already selected by the ED-ALL desktop player. It does not load Piped or Invidious, and it does not change browser, Android/NewPipe, or existing desktop online playback paths.

## Storage design

- Each video/audio track is stored as independently authenticated AES-256-GCM chunks.
- The encryption key is wrapped through Electron's asynchronous safeStorage API when available (with compatibility for older synchronous Electron versions). On Windows this delegates key protection to Windows user-account protection (DPAPI).
- If OS-backed secure key storage is unavailable, the feature fails closed. It never falls back to an unencrypted download. The feature is disabled outside Windows rather than accepting a weaker key-storage backend.
- No plaintext temporary media file is created. Plaintext exists only in bounded in-memory chunks while the encrypted file is written or read.
- The offline manifest, including the wrapped key and chunk index, is protected with safeStorage.
- Media playback supports HTTP byte ranges. A chunk is fully authenticated before any bytes from that chunk are returned.
- Deleting an item removes the manifest (which holds the wrapped key) and encrypted files. Secure physical erasure is not guaranteed on SSDs or journaled filesystems.

## User flow

1. Open a lesson in the Windows EdAll desktop program.
2. Select a quality in the existing player and choose **Save encrypted offline**.
3. The desktop app downloads the existing yt-dlp stream, encrypts it, and stores it under the app's user-data directory.
4. Open **Downloads** in the desktop menu or **Saved downloads** under the player to view, play, or delete saved lessons.
5. The local library is available even when the platform website cannot be reached.

## Security boundary and limitations

This is encryption at rest, not an unbreakable DRM system. A user who controls the same Windows account and can instrument the running application may ultimately capture media while it is being decrypted for playback. The feature does not currently add a server-signed offline entitlement or time-limited license renewal; product/content-rights policy must be reviewed before public rollout. Saved files remain associated with the current Windows user profile until deleted.

The main process accepts requests only from the platform's main frame, and only saves a stream token already registered by the existing yt-dlp playback path. The local library page is the only additional local file page allowed by navigation policy. Stream URLs and request headers are not persisted in the offline manifest.

## Validation

The **Windows encrypted offline media vault** workflow runs Node syntax checks and unit tests for:
- encrypted round-trip and plaintext absence,
- authenticated chunk integrity/tamper rejection,
- byte-range reads,
- OS key-storage unavailable fail-closed behavior,
- video/audio library save, list, playback and delete operations,
- rejection of malformed IDs and non-success provider responses.

A Windows packaging/playback smoke test on a real Windows install is still required before release.