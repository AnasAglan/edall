'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { OfflineLibrary } = require('./offline-library.cjs');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function createTestSafeStorage() {
  const master = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', master, nonce);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    },
    decryptString(payload) {
      const nonce = payload.subarray(0, 12);
      const tag = payload.subarray(12, 28);
      const body = payload.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', master, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    }
  };
}

async function collect(stream) {
  const parts = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

async function createLibrary(t, fetchMedia, safeStorage = createTestSafeStorage()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'edall-library-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new OfflineLibrary({
    directory,
    safeStorage,
    fetchMedia
  });
}

test('saves encrypted video and audio without plaintext files and lists safe metadata', async t => {
  const videoBytes = Buffer.from('video-plaintext-'.repeat(50000));
  const audioBytes = Buffer.from('audio-plaintext-'.repeat(10000));
  const videoExpected = Buffer.from(videoBytes);
  const audioExpected = Buffer.from(audioBytes);
  const library = await createLibrary(t, async reference => ({
    status: 200,
    contentType: reference.mimeType,
    body: Readable.from([reference.mimeType.startsWith('video/') ? videoBytes : audioBytes])
  }));

  const saved = await library.save({
    userId: USER_A,
    title: 'Biology lesson',
    videoId: 'abcdefghijk',
    height: 720,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' },
    audio: { url: 'opaque-audio-token', mimeType: 'audio/mp4' }
  });
  assert.equal(saved.title, 'Biology lesson');
  assert.equal(saved.hasSeparateAudio, true);
  const entries = await library.list(USER_A);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, saved.id);

  const video = await library.createResponse(saved.id, 'video', undefined, USER_A);
  const audio = await library.createResponse(saved.id, 'audio', undefined, USER_A);
  assert.deepEqual(await collect(video.body), videoExpected);
  assert.deepEqual(await collect(audio.body), audioExpected);

  const videoFile = await fs.readFile(library.mediaPath(saved.id, 'video'));
  const audioFile = await fs.readFile(library.mediaPath(saved.id, 'audio'));
  assert.equal(videoFile.includes(Buffer.from('video-plaintext-')), false);
  assert.equal(audioFile.includes(Buffer.from('audio-plaintext-')), false);
  assert.equal(videoFile.subarray(0, 8).toString('ascii'), 'EDALLEN1');
});

test('supports authenticated HTTP byte ranges for offline playback', async t => {
  const bytes = Buffer.from(Array.from({ length: 150000 }, (_, i) => i % 239));
  const expected = Buffer.from(bytes);
  const library = await createLibrary(t, async reference => ({
    status: 200,
    contentType: reference.mimeType,
    body: Readable.from([bytes])
  }));
  const saved = await library.save({
    userId: USER_A,
    title: 'Physics',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  });
  const response = await library.createResponse(saved.id, 'video', 'bytes=2000-8000', USER_A);
  assert.equal(response.status, 206);
  assert.equal(response.headers['Content-Range'], 'bytes 2000-8000/150000');
  assert.deepEqual(await collect(response.body), expected.subarray(2000, 8001));
});


test('saves, lists and plays manifests using modern async Electron safeStorage', async t => {
  const legacy = createTestSafeStorage();
  const asyncOnly = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => legacy.encryptString(value),
    decryptStringAsync: async value => ({
      result: legacy.decryptString(value),
      shouldReEncrypt: false
    })
  };
  const bytes = Buffer.from('async-library-content-'.repeat(3000));
  const expected = Buffer.from(bytes);
  const library = await createLibrary(t, async reference => ({
    status: 200,
    contentType: reference.mimeType,
    body: Readable.from([bytes])
  }), asyncOnly);

  const saved = await library.save({
    userId: USER_A,
    title: 'Async storage lesson',
    videoId: 'abcdefghijk',
    height: 480,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  });
  const listed = await library.list(USER_A);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, saved.id);
  const playback = await library.createResponse(saved.id, 'video', undefined, USER_A);
  assert.deepEqual(await collect(playback.body), expected);
});

test('rejects malformed video IDs, path traversal IDs and failed provider responses', async t => {
  const library = await createLibrary(t, async () => ({ status: 403, body: null }));
  await assert.rejects(() => library.save({
    userId: USER_A,
    title: 'Bad',
    videoId: '../secrets',
    height: 360,
    video: { url: 'x', mimeType: 'video/mp4' }
  }));
  await assert.rejects(() => library.createResponse('../../secrets', 'video', undefined, USER_A));
  await assert.rejects(() => library.save({
    userId: USER_A,
    title: 'Denied',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-token', mimeType: 'video/mp4' }
  }), /complete stream/);
});


test('rejects successful HTTP responses that are not media or have the wrong track type', async t => {
  const htmlLibrary = await createLibrary(t, async () => ({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: Readable.from([Buffer.from('<html>provider error</html>')])
  }));
  await assert.rejects(() => htmlLibrary.save({
    userId: USER_A,
    title: 'Not a video',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-token', mimeType: 'video/mp4' }
  }), /unexpected media type/);
  assert.deepEqual(await htmlLibrary.list(USER_A), []);

  const wrongTrackLibrary = await createLibrary(t, async () => ({
    status: 200,
    contentType: 'video/mp4',
    body: Readable.from([Buffer.from('not-audio')])
  }));
  await assert.rejects(() => wrongTrackLibrary.save({
    userId: USER_A,
    title: 'Wrong audio track',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-video', mimeType: 'video/mp4' },
    audio: { url: 'opaque-audio', mimeType: 'audio/mp4' }
  }), /unexpected media type/);
  assert.deepEqual(await wrongTrackLibrary.list(USER_A), []);
});

test('deletes the encrypted media and manifest as one library item', async t => {
  const library = await createLibrary(t, async reference => ({
    status: 200,
    contentType: reference.mimeType,
    body: Readable.from([Buffer.from('encrypted content')])
  }));
  const saved = await library.save({
    userId: USER_A,
    title: 'Chemistry',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  });
  assert.equal(await library.remove(saved.id, USER_A), true);
  assert.deepEqual(await library.list(USER_A), []);
});

test('does not expose or play another ED-ALL account downloads', async t => {
  const bytes = Buffer.from('account-scoped-media-'.repeat(3000));
  const library = await createLibrary(t, async reference => ({
    status: 200,
    contentType: reference.mimeType,
    body: Readable.from([bytes])
  }));
  const saved = await library.save({
    userId: USER_A,
    title: 'Private lesson',
    videoId: 'abcdefghijk',
    height: 720,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  });

  assert.equal((await library.list(USER_A)).length, 1);
  assert.equal((await library.list(USER_B)).length, 0);
  assert.equal(await library.remove(saved.id, USER_B), false);
  await assert.rejects(
    () => library.createResponse(saved.id, 'video', undefined, USER_B),
    /another ED-ALL account/
  );
  assert.equal((await library.list(USER_A)).length, 1);

  const ownPlayback = await library.createResponse(saved.id, 'video', undefined, USER_A);
  assert.deepEqual(await collect(ownPlayback.body), bytes);
  assert.equal(await library.remove(saved.id, USER_A), true);
  assert.equal((await library.list(USER_A)).length, 0);
});

test('requires a valid account ID before saving or listing offline media', async t => {
  const library = await createLibrary(t, async () => ({
    status: 200,
    contentType: 'video/mp4',
    body: Readable.from([Buffer.from('video')])
  }));
  await assert.rejects(() => library.save({
    userId: 'not-a-user',
    title: 'Invalid owner',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  }), /valid ED-ALL account/);
  await assert.rejects(() => library.list(), /valid ED-ALL account/);
});

test('persists the last authorized ED-ALL account only inside OS-protected storage', async t => {
  const library = await createLibrary(t, async () => ({
    status: 200,
    contentType: 'video/mp4',
    body: Readable.from([Buffer.from('x')])
  }));
  assert.equal(await library.getRememberedAccount(), null);
  await library.rememberAccount(USER_A);
  assert.equal(await library.getRememberedAccount(), USER_A);
  await assert.rejects(() => library.rememberAccount('not-a-user'), /valid ED-ALL account/);
  await library.clearRememberedAccount();
  assert.equal(await library.getRememberedAccount(), null);
});
