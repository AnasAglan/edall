'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  encryptMediaStream,
  createEncryptedMediaResponse
} = require('./offline-vault.cjs');

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
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function withTemp(t, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'edall-vault-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await callback(directory);
}

test('stores only authenticated encrypted chunks and round-trips the original stream', async t => {
  await withTemp(t, async directory => {
    const plain = Buffer.from('private lesson video content '.repeat(120000));
    const expected = Buffer.from(plain);
    const safeStorage = createTestSafeStorage();
    const filePath = path.join(directory, 'sample.edenc');
    const descriptor = await encryptMediaStream({
      source: Readable.from([plain.subarray(0, 101), plain.subarray(101, 400000), plain.subarray(400000)]),
      filePath,
      safeStorage,
      contentType: 'video/mp4'
    });

    const stored = await fs.readFile(filePath);
    assert.equal(stored.subarray(0, 8).toString('ascii'), 'EDALLEN1');
    assert.equal(stored.includes(Buffer.from('private lesson video content')), false);
    assert.equal(descriptor.format, 'EDALLEN1');
    assert.equal(descriptor.totalBytes, expected.length);
    assert.ok(descriptor.chunks.length > 1);

    const response = createEncryptedMediaResponse({ filePath, descriptor, safeStorage });
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'video/mp4');
    assert.deepEqual(await collect(response.body), expected);
  });
});

test('decrypts only requested byte ranges and returns correct partial headers', async t => {
  await withTemp(t, async directory => {
    const plain = Buffer.from(Array.from({ length: 200000 }, (_, i) => i % 251));
    const expected = Buffer.from(plain);
    const safeStorage = createTestSafeStorage();
    const filePath = path.join(directory, 'range.edenc');
    const descriptor = await encryptMediaStream({
      source: Readable.from([plain]),
      filePath,
      safeStorage,
      contentType: 'video/webm'
    });

    const response = createEncryptedMediaResponse({
      filePath,
      descriptor,
      safeStorage,
      rangeHeader: 'bytes=12345-54321'
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers['Content-Range'], 'bytes 12345-54321/200000');
    assert.equal(response.headers['Content-Length'], '41977');
    assert.deepEqual(await collect(response.body), expected.subarray(12345, 54322));
  });
});

test('authenticates each encrypted chunk before returning its plaintext', async t => {
  await withTemp(t, async directory => {
    const safeStorage = createTestSafeStorage();
    const filePath = path.join(directory, 'tamper.edenc');
    const descriptor = await encryptMediaStream({
      source: Readable.from([Buffer.from('tamper-detection-data-'.repeat(1000))]),
      filePath,
      safeStorage,
      contentType: 'video/mp4'
    });
    const file = await fs.readFile(filePath);
    file[file.length - 1] ^= 0x01;
    await fs.writeFile(filePath, file);

    const response = createEncryptedMediaResponse({ filePath, descriptor, safeStorage });
    await assert.rejects(() => collect(response.body));
  });
});


test('uses Electron asynchronous safeStorage APIs when available', async t => {
  await withTemp(t, async directory => {
    const legacy = createTestSafeStorage();
    const asyncOnly = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async value => legacy.encryptString(value),
      decryptStringAsync: async value => ({
        result: legacy.decryptString(value),
        shouldReEncrypt: false
      })
    };
    const plain = Buffer.from('modern electron async safe storage'.repeat(1000));
    const expected = Buffer.from(plain);
    const filePath = path.join(directory, 'async.edenc');
    const descriptor = await encryptMediaStream({
      source: Readable.from([plain]),
      filePath,
      safeStorage: asyncOnly,
      contentType: 'video/mp4'
    });
    const response = createEncryptedMediaResponse({
      filePath,
      descriptor,
      safeStorage: asyncOnly
    });
    assert.deepEqual(await collect(response.body), expected);
  });
});

test('fails closed when OS-backed key storage is unavailable', async t => {
  await withTemp(t, async directory => {
    const filePath = path.join(directory, 'no-key.edenc');
    const unavailable = {
      isEncryptionAvailable: () => false,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString()
    };
    await assert.rejects(
      () => encryptMediaStream({
        source: Readable.from([Buffer.from('no plaintext fallback')]),
        filePath,
        safeStorage: unavailable,
        contentType: 'video/mp4'
      }),
      /OS-backed secure key storage is unavailable/
    );
    await assert.rejects(() => fs.access(filePath));
  });
});
