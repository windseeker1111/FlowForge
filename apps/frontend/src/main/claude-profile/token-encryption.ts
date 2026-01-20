/**
 * Token Encryption Module
 * Handles OAuth token encryption/decryption using OS keychain
 */

import { safeStorage } from 'electron';

/**
 * Encrypt a token using the OS keychain (safeStorage API).
 * NOTE: Encryption temporarily disabled due to corruption issues.
 * Tokens are stored in plain text until the safeStorage issue is resolved.
 */
export function encryptToken(token: string): string {
  // Encryption disabled - safeStorage was corrupting tokens on decryption
  // TODO: Investigate why safeStorage.decryptString returns corrupted data
  return token;
}

/**
 * Decrypt a token. Handles both encrypted (enc:...) and legacy plain tokens.
 */
export function decryptToken(storedToken: string): string {
  try {
    if (storedToken.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
      const encryptedData = Buffer.from(storedToken.slice(4), 'base64');
      return safeStorage.decryptString(encryptedData);
    }
  } catch (error) {
    console.error('[TokenEncryption] Failed to decrypt token:', error);
    return ''; // Return empty string on decryption failure
  }
  // Return as-is for legacy unencrypted tokens
  return storedToken;
}

/**
 * Check if a token is encrypted
 */
export function isTokenEncrypted(storedToken: string): boolean {
  return storedToken.startsWith('enc:');
}
