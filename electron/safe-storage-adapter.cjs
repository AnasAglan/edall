'use strict';

async function isSafeStorageAvailable(safeStorage) {
  if (safeStorage && typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
    return await safeStorage.isAsyncEncryptionAvailable() === true;
  }
  if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function') {
    return safeStorage.isEncryptionAvailable() === true;
  }
  return false;
}

async function safeStorageEncryptString(safeStorage, value) {
  if (safeStorage && typeof safeStorage.encryptStringAsync === 'function') {
    const encrypted = await safeStorage.encryptStringAsync(String(value));
    if (!Buffer.isBuffer(encrypted)) throw new Error('OS secure storage returned an invalid encrypted value.');
    return encrypted;
  }
  if (safeStorage && typeof safeStorage.encryptString === 'function') {
    const encrypted = safeStorage.encryptString(String(value));
    if (!Buffer.isBuffer(encrypted)) throw new Error('OS secure storage returned an invalid encrypted value.');
    return encrypted;
  }
  throw new Error('OS-backed secure key storage is unavailable.');
}

async function safeStorageDecryptString(safeStorage, encrypted) {
  if (!Buffer.isBuffer(encrypted)) throw new TypeError('Encrypted safe-storage data must be a Buffer.');
  if (safeStorage && typeof safeStorage.decryptStringAsync === 'function') {
    const result = await safeStorage.decryptStringAsync(encrypted);
    const plaintext = typeof result === 'string' ? result : result && result.result;
    if (typeof plaintext !== 'string') throw new Error('OS secure storage returned an invalid decrypted value.');
    return plaintext;
  }
  if (safeStorage && typeof safeStorage.decryptString === 'function') {
    const plaintext = safeStorage.decryptString(encrypted);
    if (typeof plaintext !== 'string') throw new Error('OS secure storage returned an invalid decrypted value.');
    return plaintext;
  }
  throw new Error('OS-backed secure key storage is unavailable.');
}

async function assertSafeStorageAvailable(safeStorage) {
  if (!(await isSafeStorageAvailable(safeStorage))) {
    throw new Error('OS-backed secure key storage is unavailable; encrypted downloads are disabled.');
  }
}

module.exports = {
  isSafeStorageAvailable,
  assertSafeStorageAvailable,
  safeStorageEncryptString,
  safeStorageDecryptString
};
