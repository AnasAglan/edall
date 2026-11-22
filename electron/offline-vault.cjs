'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const MAGIC = Buffer.from('EDALLEN1', 'ascii');
const CHUNK_BYTES = 1024 * 1024;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const RECORD_HEADER_BYTES = 4 + NONCE_BYTES + TAG_BYTES;

function assertSafeStorage(safeStorage) {
  if (
    !safeStorage ||
    typeof safeStorage.isEncryptionAvailable !== 'function' ||
    typeof safeStorage.encryptString !== 'function' ||
    typeof safeStorage.decryptString !== 'function' ||
    safeStorage.isEncryptionAvailable() !== true
  ) {
    throw new Error('OS-backed secure key storage is unavailable; encrypted downloads are disabled.');
  }
}

async function writeBuffer(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new Error('Could not write the encrypted media file.');
    offset += bytesWritten;
  }
}

/**
 * Encrypts a readable stream into independently authenticated AES-256-GCM chunks.
 * The AES key is wrapped by Electron safeStorage (Windows DPAPI) before it is
 * returned. No plaintext temp file is created.
 */
async function encryptMediaStream({ source, filePath, safeStorage, contentType }) {
  assertSafeStorage(safeStorage);
  if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('A readable media stream is required.');
  }
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('An absolute encrypted media path is required.');
  }

  const key = crypto.randomBytes(32);
  let encryptedKey;
  try {
    encryptedKey = safeStorage.encryptString(key.toString('base64')).toString('base64');
  } catch {
    key.fill(0);
    throw new Error('The operating system could not protect the offline media key.');
  }

  const directory = path.dirname(filePath);
  const temporaryPath = filePath + '.' + crypto.randomUUID() + '.part';
  let handle;
  const chunks = [];
  let fileOffset = MAGIC.length;
  let plainOffset = 0;
  let pending = Buffer.alloc(0);

  const writeChunk = async plain => {
    if (!plain.length) return;
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(encrypted.length, 0);

    await writeBuffer(handle, length);
    await writeBuffer(handle, nonce);
    await writeBuffer(handle, tag);
    await writeBuffer(handle, encrypted);

    chunks.push({
      offset: fileOffset,
      plainOffset,
      plainLength: plain.length,
      cipherLength: encrypted.length
    });
    fileOffset += RECORD_HEADER_BYTES + encrypted.length;
    plainOffset += plain.length;
    encrypted.fill(0);
    plain.fill(0);
  };

  try {
    await fs.mkdir(directory, { recursive: true });
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await writeBuffer(handle, MAGIC);

    for await (const raw of source) {
      const incoming = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let data = pending.length ? Buffer.concat([pending, incoming]) : incoming;
      let offset = 0;
      while (data.length - offset >= CHUNK_BYTES) {
        await writeChunk(data.subarray(offset, offset + CHUNK_BYTES));
        offset += CHUNK_BYTES;
      }
      pending = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0);
    }
    if (pending.length) await writeChunk(pending);
    if (plainOffset === 0) throw new Error('The provider returned an empty media stream.');

    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);

    return {
      encryptedKey,
      totalBytes: plainOffset,
      contentType: typeof contentType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(contentType)
        ? contentType
        : 'application/octet-stream',
      chunks,
      format: 'EDALLEN1'
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    await fs.unlink(filePath).catch(() => {});
    throw error;
  } finally {
    key.fill(0);
    pending.fill(0);
  }
}

function parseRange(rangeHeader, totalBytes) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return null;
  if (!rangeHeader) return { start: 0, end: totalBytes - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalBytes - suffix);
    end = totalBytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalBytes - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return null;
    if (start >= totalBytes) return null;
    end = Math.min(end, totalBytes - 1);
  }
  return { start, end, partial: true };
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (!bytesRead) throw new Error('Encrypted media file is truncated.');
    done += bytesRead;
  }
  return buffer;
}

/**
 * Creates an authenticated read stream, including HTTP byte-range support.
 * A chunk is authenticated in full before any part of its plaintext is emitted.
 */
function createEncryptedMediaResponse({ filePath, descriptor, safeStorage, rangeHeader }) {
  assertSafeStorage(safeStorage);
  if (
    !descriptor ||
    descriptor.format !== 'EDALLEN1' ||
    typeof descriptor.encryptedKey !== 'string' ||
    !Array.isArray(descriptor.chunks)
  ) throw new Error('Invalid offline media manifest.');

  const range = parseRange(rangeHeader, descriptor.totalBytes);
  if (!range) {
    const error = new Error('Requested media range is not satisfiable.');
    error.statusCode = 416;
    error.contentRange = 'bytes */' + String(descriptor.totalBytes || 0);
    throw error;
  }

  const contentLength = range.end - range.start + 1;
  const headers = {
    'Content-Type': descriptor.contentType || 'application/octet-stream',
    'Content-Length': String(contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };
  if (range.partial) headers['Content-Range'] =
    'bytes ' + range.start + '-' + range.end + '/' + descriptor.totalBytes;

  const body = Readable.from((async function* () {
    let key;
    let handle;
    try {
      const encryptedKey = Buffer.from(descriptor.encryptedKey, 'base64');
      key = Buffer.from(safeStorage.decryptString(encryptedKey), 'base64');
      if (key.length !== 32) throw new Error('Offline media key is invalid.');

      handle = await fs.open(filePath, 'r');
      const magic = await readExact(handle, MAGIC.length, 0);
      if (!magic.equals(MAGIC)) throw new Error('Offline media file header is invalid.');

      for (const entry of descriptor.chunks) {
        const chunkStart = entry.plainOffset;
        const chunkEnd = chunkStart + entry.plainLength - 1;
        if (chunkEnd < range.start || chunkStart > range.end) continue;
        if (
          !Number.isSafeInteger(entry.offset) ||
          !Number.isSafeInteger(entry.cipherLength) ||
          !Number.isSafeInteger(entry.plainLength) ||
          entry.cipherLength !== entry.plainLength
        ) throw new Error('Offline media index is invalid.');

        const lengthBytes = await readExact(handle, 4, entry.offset);
        if (lengthBytes.readUInt32BE(0) !== entry.cipherLength) {
          throw new Error('Offline media chunk length is invalid.');
        }
        const nonce = await readExact(handle, NONCE_BYTES, entry.offset + 4);
        const tag = await readExact(handle, TAG_BYTES, entry.offset + 4 + NONCE_BYTES);
        const encrypted = await readExact(
          handle,
          entry.cipherLength,
          entry.offset + RECORD_HEADER_BYTES
        );
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        encrypted.fill(0);
        if (plain.length !== entry.plainLength) {
          plain.fill(0);
          throw new Error('Offline media chunk size is invalid.');
        }
        const from = Math.max(0, range.start - chunkStart);
        const to = Math.min(plain.length, range.end - chunkStart + 1);
        const output = Buffer.from(plain.subarray(from, to));
        plain.fill(0);
        if (output.length) yield output;
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (key) key.fill(0);
    }
  })());

  return { status: range.partial ? 206 : 200, headers, body };
}

module.exports = {
  CHUNK_BYTES,
  MAGIC,
  encryptMediaStream,
  createEncryptedMediaResponse,
  parseRange
};
