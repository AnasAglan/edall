'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { encryptMediaStream, createEncryptedMediaResponse } = require('./offline-vault.cjs');
const {
  assertSafeStorageAvailable,
  safeStorageEncryptString,
  safeStorageDecryptString
} = require('./safe-storage-adapter.cjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function discardBody(body) {
  if (!body) return;
  if (typeof body.destroy === 'function') {
    body.destroy();
    return;
  }
  if (typeof body.cancel === 'function') {
    Promise.resolve(body.cancel()).catch(() => {});
  }
}

class OfflineLibrary {
  constructor({ directory, safeStorage, fetchMedia }) {
    if (!path.isAbsolute(directory)) throw new TypeError('Offline storage path must be absolute.');
    if (typeof fetchMedia !== 'function') throw new TypeError('A trusted media fetcher is required.');
    this.directory = directory;
    this.accountPath = path.join(directory, 'active-account.bin');
    this.safeStorage = safeStorage;
    this.fetchMedia = fetchMedia;
  }

  async rememberAccount(userId) {
    if (!UUID_PATTERN.test(String(userId || ''))) throw new Error('A valid ED-ALL account is required.');
    await assertSafeStorageAvailable(this.safeStorage);
    await fs.mkdir(this.directory, { recursive: true });
    const encrypted = await safeStorageEncryptString(this.safeStorage, String(userId));
    const temporary = this.accountPath + '.part';
    await fs.writeFile(temporary, Buffer.from(encrypted).toString('base64'), { flag: 'w', mode: 0o600 });
    await fs.rename(temporary, this.accountPath);
    return true;
  }

  async getRememberedAccount() {
    try {
      await assertSafeStorageAvailable(this.safeStorage);
      const encoded = await fs.readFile(this.accountPath, 'utf8');
      const userId = await safeStorageDecryptString(this.safeStorage, Buffer.from(encoded, 'base64'));
      return UUID_PATTERN.test(String(userId || '')) ? String(userId) : null;
    } catch {
      return null;
    }
  }

  async clearRememberedAccount() {
    await fs.unlink(this.accountPath).catch(() => {});
    await fs.unlink(this.accountPath + '.part').catch(() => {});
    return true;
  }

  manifestPath(id) {
    if (!UUID_PATTERN.test(String(id))) throw new Error('Invalid offline download ID.');
    return path.join(this.directory, String(id) + '.manifest');
  }

  mediaPath(id, role) {
    if (!UUID_PATTERN.test(String(id)) || !['video', 'audio'].includes(role)) {
      throw new Error('Invalid offline media reference.');
    }
    return path.join(this.directory, String(id) + '-' + role + '.edenc');
  }

  async readManifest(id) {
    const encrypted = await fs.readFile(this.manifestPath(id), 'utf8');
    const json = await safeStorageDecryptString(this.safeStorage, Buffer.from(encrypted, 'base64'));
    const manifest = JSON.parse(json);
    if (
      manifest.id !== id ||
      manifest.version !== 2 ||
      !UUID_PATTERN.test(String(manifest.userId || '')) ||
      !manifest.video ||
      !manifest.video.encryptedKey ||
      !Array.isArray(manifest.video.chunks)
    ) throw new Error('Offline download manifest is invalid.');
    return manifest;
  }

  async save({ userId, title, videoId, height, video, audio = null }) {
    await assertSafeStorageAvailable(this.safeStorage);
    if (!UUID_PATTERN.test(String(userId || ''))) throw new Error('A valid ED-ALL account is required.');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId))) throw new Error('Invalid video reference.');
    if (!Number.isInteger(Number(height)) || Number(height) < 144 || Number(height) > 4320) {
      throw new Error('Invalid video quality.');
    }
    if (!video || typeof video.url !== 'string' || typeof video.mimeType !== 'string') {
      throw new Error('A valid video stream is required.');
    }
    if (audio && (typeof audio.url !== 'string' || typeof audio.mimeType !== 'string')) {
      throw new Error('A valid audio stream is required.');
    }

    const id = crypto.randomUUID();
    await fs.mkdir(this.directory, { recursive: true });
    const createdFiles = [];
    const cleanTitle = String(title || 'ED-ALL lesson')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'ED-ALL lesson';

    const encryptOne = async (role, reference) => {
      const response = await this.fetchMedia(reference);
      if (!response || response.status !== 200 || !response.body) {
        if (response && response.body) discardBody(response.body);
        throw new Error('The media provider did not return a complete stream.');
      }
      const expectedPrefix = role === 'video' ? 'video/' : 'audio/';
      const declaredType = String(reference.mimeType || '').toLowerCase();
      const responseType = String(response.contentType || '').split(';')[0].trim().toLowerCase();
      if (!declaredType.startsWith(expectedPrefix)) {
        throw new Error('The selected media track has an unexpected content type.');
      }
      if (
        responseType &&
        responseType !== 'application/octet-stream' &&
        !responseType.startsWith(expectedPrefix)
      ) {
        discardBody(response.body);
        throw new Error('The media provider returned an unexpected media type; the file was not saved.');
      }
      const filePath = this.mediaPath(id, role);
      const descriptor = await encryptMediaStream({
        source: response.body,
        filePath,
        safeStorage: this.safeStorage,
        contentType: declaredType
      });
      createdFiles.push(filePath);
      return descriptor;
    };

    try {
      const videoDescriptor = await encryptOne('video', video);
      let audioDescriptor = null;
      if (audio) audioDescriptor = await encryptOne('audio', audio);

      const manifest = {
        version: 2,
        id,
        userId: String(userId),
        title: cleanTitle,
        videoId: String(videoId),
        height: Number(height),
        createdAt: new Date().toISOString(),
        video: videoDescriptor,
        audio: audioDescriptor
      };
      const serialized = (await safeStorageEncryptString(this.safeStorage, JSON.stringify(manifest))).toString('base64');
      const target = this.manifestPath(id);
      const temporary = target + '.part';
      await fs.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);

      return this.publicEntry(manifest);
    } catch (error) {
      await Promise.all(createdFiles.map(file => fs.unlink(file).catch(() => {})));
      await fs.unlink(this.manifestPath(id)).catch(() => {});
      await fs.unlink(this.manifestPath(id) + '.part').catch(() => {});
      throw error;
    }
  }

  publicEntry(manifest) {
    return {
      id: manifest.id,
      title: manifest.title,
      videoId: manifest.videoId,
      height: manifest.height,
      createdAt: manifest.createdAt,
      hasSeparateAudio: !!manifest.audio,
      sizeBytes: manifest.video.totalBytes + (manifest.audio ? manifest.audio.totalBytes : 0)
    };
  }

  async list(userId) {
    if (!UUID_PATTERN.test(String(userId || ''))) throw new Error('A valid ED-ALL account is required.');
    await fs.mkdir(this.directory, { recursive: true });
    const names = await fs.readdir(this.directory);
    const entries = [];
    for (const name of names) {
      if (!name.endsWith('.manifest')) continue;
      const id = name.slice(0, -'.manifest'.length);
      if (!UUID_PATTERN.test(id)) continue;
      try {
        const manifest = await this.readManifest(id);
        if (manifest.userId === userId) entries.push(this.publicEntry(manifest));
      } catch {
        // Legacy or corrupt manifests are not visible to any account.
      }
    }
    return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async remove(id, userId) {
    if (!UUID_PATTERN.test(String(userId || ''))) throw new Error('A valid ED-ALL account is required.');
    const target = this.manifestPath(id);
    let manifest;
    try { manifest = await this.readManifest(id); } catch { return false; }
    if (manifest.userId !== userId) return false;
    await Promise.all([
      fs.unlink(this.mediaPath(id, 'video')).catch(() => {}),
      fs.unlink(this.mediaPath(id, 'audio')).catch(() => {}),
      fs.unlink(target).catch(() => {}),
      fs.unlink(target + '.part').catch(() => {})
    ]);
    return true;
  }

  async createResponse(id, role, rangeHeader, userId) {
    if (!UUID_PATTERN.test(String(userId || ''))) throw new Error('A valid ED-ALL account is required.');
    if (!['video', 'audio'].includes(role)) throw new Error('Invalid offline media type.');
    const manifest = await this.readManifest(id);
    if (manifest.userId !== userId) throw new Error('This offline item belongs to another ED-ALL account.');
    const descriptor = role === 'video' ? manifest.video : manifest.audio;
    if (!descriptor) throw new Error('This offline download has no separate audio track.');
    return createEncryptedMediaResponse({
      filePath: this.mediaPath(id, role),
      descriptor,
      safeStorage: this.safeStorage,
      rangeHeader
    });
  }
}

module.exports = { OfflineLibrary };
