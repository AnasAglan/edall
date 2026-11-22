'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { encryptMediaStream, createEncryptedMediaResponse } = require('./offline-vault.cjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class OfflineLibrary {
  constructor({ directory, safeStorage, fetchMedia }) {
    if (!path.isAbsolute(directory)) throw new TypeError('Offline storage path must be absolute.');
    if (typeof fetchMedia !== 'function') throw new TypeError('A trusted media fetcher is required.');
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.fetchMedia = fetchMedia;
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
    const json = this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    const manifest = JSON.parse(json);
    if (
      manifest.id !== id ||
      manifest.version !== 1 ||
      !manifest.video ||
      !manifest.video.encryptedKey ||
      !Array.isArray(manifest.video.chunks)
    ) throw new Error('Offline download manifest is invalid.');
    return manifest;
  }

  async save({ title, videoId, height, video, audio = null }) {
    if (
      !this.safeStorage ||
      typeof this.safeStorage.isEncryptionAvailable !== 'function' ||
      this.safeStorage.isEncryptionAvailable() !== true
    ) throw new Error('OS-backed secure key storage is unavailable; offline saving is disabled.');
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
        throw new Error('The media provider returned a non-media response; the file was not saved.');
      }
      const filePath = this.mediaPath(id, role);
      const descriptor = await encryptMediaStream({
        source: response.body,
        filePath,
        safeStorage: this.safeStorage,
        contentType: !responseType || responseType === 'application/octet-stream'
          ? declaredType
          : responseType
      });
      createdFiles.push(filePath);
      return descriptor;
    };

    try {
      const videoDescriptor = await encryptOne('video', video);
      let audioDescriptor = null;
      if (audio) audioDescriptor = await encryptOne('audio', audio);

      const manifest = {
        version: 1,
        id,
        title: cleanTitle,
        videoId: String(videoId),
        height: Number(height),
        createdAt: new Date().toISOString(),
        video: videoDescriptor,
        audio: audioDescriptor
      };
      const serialized = this.safeStorage.encryptString(JSON.stringify(manifest)).toString('base64');
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

  async list() {
    await fs.mkdir(this.directory, { recursive: true });
    const names = await fs.readdir(this.directory);
    const entries = [];
    for (const name of names) {
      if (!name.endsWith('.manifest')) continue;
      const id = name.slice(0, -'.manifest'.length);
      if (!UUID_PATTERN.test(id)) continue;
      try {
        entries.push(this.publicEntry(await this.readManifest(id)));
      } catch {
        // Keep corrupt manifests for support recovery, but do not render untrusted content.
      }
    }
    return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async remove(id) {
    const target = this.manifestPath(id);
    let manifest;
    try { manifest = await this.readManifest(id); } catch { manifest = null; }
    await Promise.all([
      fs.unlink(this.mediaPath(id, 'video')).catch(() => {}),
      fs.unlink(this.mediaPath(id, 'audio')).catch(() => {}),
      fs.unlink(target).catch(() => {}),
      fs.unlink(target + '.part').catch(() => {})
    ]);
    return Boolean(manifest);
  }

  async createResponse(id, role, rangeHeader) {
    if (!['video', 'audio'].includes(role)) throw new Error('Invalid offline media type.');
    const manifest = await this.readManifest(id);
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
