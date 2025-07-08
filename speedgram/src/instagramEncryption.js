import { seal } from 'tweetnacl-sealedbox-js';
import { encodeBase64, decodeUTF8 } from 'tweetnacl-util';

// Constants from Instagram's encryption implementation
const OVERHEAD_LENGTH = 48; // tweetnacl-sealedbox-js overheadLength
const VERSION_LENGTH = 1;
const KEY_ID_LENGTH = 1;
const SEALED_KEY_LENGTH = 32;
const TAG_LENGTH = 16;
const LENGTH_FIELD_LENGTH = 2;

class InstagramBrowserEncryption {
  constructor() {
    this.encryptionKeys = null;
  }

  // Get encryption keys from Instagram's shared data endpoint
  async getSharedData() {
    try {
      const response = await this.sendMessageToExtension({
        action: 'makeRequest',
        method: 'GET',
        url: 'https://www.instagram.com/api/v1/web/data/shared_data/',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        }
      });

      if (response.status === 200) {
        const data = JSON.parse(response.data);
        this.encryptionKeys = {
          keyId: data.encryption.key_id,
          publicKey: data.encryption.public_key,
          version: data.encryption.version
        };
        return this.encryptionKeys;
      }
      throw new Error('Failed to get shared data');
    } catch (error) {
      console.error('Error getting shared data:', error);
      throw error;
    }
  }

  // Convert hex string to Uint8Array
  hexStringToUint8Array(hexString) {
    const bytes = [];
    for (let i = 0; i < hexString.length; i += 2) {
      bytes.push(parseInt(hexString.slice(i, i + 2), 16));
    }
    return new Uint8Array(bytes);
  }

  // Implement envelope encryption similar to Instagram's PolarisEnvelopeEncryption
  async envelopeEncrypt(keyId, publicKey, version, password, timestamp) {
    const passwordBytes = decodeUTF8(password);
    const timestampBytes = decodeUTF8(timestamp);
    
    const totalLength = VERSION_LENGTH + KEY_ID_LENGTH + LENGTH_FIELD_LENGTH + 
                       SEALED_KEY_LENGTH + OVERHEAD_LENGTH + TAG_LENGTH + passwordBytes.length;

    if (publicKey.length !== 128) { // 64 bytes = 128 hex chars
      throw new Error('Public key is not a valid hex string');
    }

    const publicKeyBytes = this.hexStringToUint8Array(publicKey);
    if (!publicKeyBytes) {
      throw new Error('Public key is not a valid hex string');
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;

    // Version
    result[offset] = version;
    offset += VERSION_LENGTH;

    // Key ID
    result[offset] = keyId;
    offset += KEY_ID_LENGTH;

    // Generate AES-GCM key and encrypt
    const aesKey = await window.crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      true,
      ['encrypt', 'decrypt']
    );

    // Export the AES key
    const exportedKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const keyBytes = new Uint8Array(exportedKey);

    // Encrypt the AES key with the public key using sealed box
    const sealedKey = seal(keyBytes, publicKeyBytes);

    // Write sealed key length
    result[offset] = sealedKey.length & 255;
    result[offset + 1] = (sealedKey.length >> 8) & 255;
    offset += LENGTH_FIELD_LENGTH;

    // Write sealed key
    result.set(sealedKey, offset);
    offset += sealedKey.length;

    if (sealedKey.length !== SEALED_KEY_LENGTH + OVERHEAD_LENGTH) {
      throw new Error('Encrypted key is the wrong length');
    }

    // Encrypt the password with AES-GCM
    const iv = new Uint8Array(12); // 96-bit IV for GCM
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        additionalData: timestampBytes,
        tagLength: TAG_LENGTH * 8
      },
      aesKey,
      passwordBytes
    );

    const encryptedBytes = new Uint8Array(encrypted);
    const tag = encryptedBytes.slice(-TAG_LENGTH);
    const ciphertext = encryptedBytes.slice(0, -TAG_LENGTH);

    // Write authentication tag
    result.set(tag, offset);
    offset += TAG_LENGTH;

    // Write ciphertext
    result.set(ciphertext, offset);

    return result;
  }

  // Format the encrypted password according to Instagram's format
  formatPassword(encryptedData, timestamp, version) {
    const encodedData = encodeBase64(encryptedData);
    return `#PWD_INSTAGRAM_BROWSER:${version}:${timestamp}:${encodedData}`;
  }

  // Main encryption function
  async encryptPassword(password) {
    try {
      // Get encryption keys if not already loaded
      if (!this.encryptionKeys) {
        await this.getSharedData();
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const encryptedData = await this.envelopeEncrypt(
        this.encryptionKeys.keyId,
        this.encryptionKeys.publicKey,
        this.encryptionKeys.version,
        password,
        timestamp
      );

      return this.formatPassword(encryptedData, timestamp, this.encryptionKeys.version);
    } catch (error) {
      console.error('Encryption failed:', error);
      // Fallback to plaintext format
      const timestamp = Math.floor(Date.now() / 1000).toString();
      return `#PWD_INSTAGRAM_BROWSER:0:${timestamp}:${password}`;
    }
  }

  // Extension communication helper
  async sendMessageToExtension(message) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Extension not available'));
        return;
      }
      
      const extensionId = window.instagramExtensionId || 'njdidabcneoijpjohimfnbjmkbilppnb';
      
      chrome.runtime.sendMessage(extensionId, message, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }
}

export default InstagramBrowserEncryption;