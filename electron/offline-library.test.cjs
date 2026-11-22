'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { OfflineLibrary } = require('./offline-library.cjs');

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

async function createLibrary(t, fetchMedia) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'edall-library-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new OfflineLibrary({
    directory,
    safeStorage: createTestSafeStorage(),
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
    title: 'Biology lesson',
    videoId: 'abcdefghijk',
    height: 720,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' },
    audio: { url: 'opaque-audio-token', mimeType: 'audio/mp4' }
  });
  assert.equal(saved.title, 'Biology lesson');
  assert.equal(saved.hasSeparateAudio, true);
  const entries = await library.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, saved.id);

  const video = await library.createResponse(saved.id, 'video');
  const audio = await library.createResponse(saved.id, 'audio');
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
    title: 'Physics',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  });
  const response = await library.createResponse(saved.id, 'video', 'bytes=2000-8000');
  assert.equal(response.status, 206);
  assert.equal(response.headers['Content-Range'], 'bytes 2000-8000/150000');
  assert.deepEqual(await collect(response.body), expected.subarray(2000, 8001));
});

test('rejects malformed video IDs, path traversal IDs and failed provider responses', async t => {
  const library = await createLibrary(t, async () => ({ status: 403, body: null }));
  await assert.rejects(() => library.save({
    title: 'Bad',
    videoId: '../secrets',
    height: 360,
    video: { url: 'x', mimeType: 'video/mp4' }
  }));
  await assert.rejects(() => library.createResponse('../../secrets', 'video'));
  await assert.rejects(() => library.save({
    title: 'Denied',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-token', mimeType: 'video/mp4' }
  }), /complete stream/);
});

test('deletes the encrypted media and manifest as one library item', async t => {
  const library = await createLibrary(t, async reference => ({
    status: 200,
    contentType: reference.mimeType,
    body: Readable.from([Buffer.from('encrypted content')])
  }));
  const saved = await library.save({
    title: 'Chemistry',
    videoId: 'abcdefghijk',
    height: 360,
    video: { url: 'opaque-video-token', mimeType: 'video/mp4' }
  });
  assert.equal(await library.remove(saved.id), true);
  assert.deepEqual(await library.list(), []);
});
