/**
 * Password-based encryption for backup files, using the browser's built-in Web Crypto.
 *   key:    PBKDF2-SHA-256, 600,000 iterations, random 16-byte salt
 *   cipher: AES-256-GCM, random 12-byte IV (GCM also detects a wrong password or a damaged file)
 * Passwords are generated, never chosen: 20 characters from a 31-letter alphabet (~99 bits).
 */

// No 0/O, 1/I/L: easy to read aloud and to type from paper.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 5, GROUP_LEN = 4;
export const PBKDF2_ITERATIONS = 600_000;

export function generatePassword(): string {
  const out: string[] = [];
  const max = 256 - (256 % ALPHABET.length); // reject bytes that would bias the choice
  while (out.length < GROUPS * GROUP_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < max && out.length < GROUPS * GROUP_LEN) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return Array.from({ length: GROUPS }, (_, i) => out.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join('')).join('-');
}

/** Accept the password however it was typed: any case, with or without dashes or spaces. */
export function normalizePassword(input: string): string {
  const chars = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return chars.match(new RegExp(`.{1,${GROUP_LEN}}`, 'g'))?.join('-') ?? '';
}

export interface EncryptedEnvelope {
  app: 'netcontrol';
  format: 'encrypted-1';
  id: string;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(value: unknown, password: string, id: string, createdAt: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    app: 'netcontrol', format: 'encrypted-1', id, createdAt,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    data: b64(sealed),
  };
}

export class WrongPasswordError extends Error {
  constructor() { super('Wrong password, or the file is damaged.'); this.name = 'WrongPasswordError'; }
}

export async function decryptJson(env: EncryptedEnvelope, password: string): Promise<unknown> {
  const key = await deriveKey(password, unb64(env.kdf.salt), env.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.cipher.iv) }, key, unb64(env.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new WrongPasswordError();
  }
}

export function isEncryptedEnvelope(v: unknown): v is EncryptedEnvelope {
  const e = v as EncryptedEnvelope;
  return !!e && e.app === 'netcontrol' && e.format === 'encrypted-1' && typeof e.data === 'string' && !!e.kdf?.salt && !!e.cipher?.iv;
}
