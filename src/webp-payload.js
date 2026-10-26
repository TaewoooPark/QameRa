// Every character is URL-fragment safe and supported by QR alphanumeric mode.
// Two binary bytes occupy three characters (16 bits in 16.5 QR data bits).
export const WEBP_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
export const MAX_WEBP_BYTES = 2800;
export const MAX_WEBP_EDGE = 384;

const RADIX = WEBP_ALPHABET.length;
const MAX_PAYLOAD_LENGTH = Math.floor(MAX_WEBP_BYTES / 2) * 3 + (MAX_WEBP_BYTES % 2) * 2;
const DIGITS = new Map([...WEBP_ALPHABET].map((character, index) => [character, index]));

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('Expected WebP bytes.');
}

export function encodeBase43(value) {
  const bytes = asBytes(value);
  if (bytes.length > MAX_WEBP_BYTES) throw new Error('This frame is too large.');
  let result = '';
  for (let index = 0; index < bytes.length; index += 2) {
    if (index + 1 === bytes.length) {
      result += WEBP_ALPHABET[Math.floor(bytes[index] / RADIX)] + WEBP_ALPHABET[bytes[index] % RADIX];
    } else {
      const pair = bytes[index] * 256 + bytes[index + 1];
      result += WEBP_ALPHABET[Math.floor(pair / (RADIX * RADIX))]
        + WEBP_ALPHABET[Math.floor(pair / RADIX) % RADIX]
        + WEBP_ALPHABET[pair % RADIX];
    }
  }
  return result;
}

export function decodeBase43(payload) {
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error('This frame link is too large.');
  }
  if (payload.length % 3 === 1) throw new Error('This frame link is incomplete.');
  const bytes = new Uint8Array(Math.floor(payload.length / 3) * 2 + (payload.length % 3 === 2 ? 1 : 0));
  let target = 0;
  for (let index = 0; index < payload.length; index += 3) {
    const count = Math.min(3, payload.length - index);
    let value = 0;
    for (let digit = 0; digit < count; digit++) {
      const decoded = DIGITS.get(payload[index + digit]);
      if (decoded === undefined) throw new Error('This frame link is damaged.');
      value = value * RADIX + decoded;
    }
    if (count === 2) {
      if (value > 255) throw new Error('This frame link has noncanonical data.');
      bytes[target++] = value;
    } else {
      if (value > 65535) throw new Error('This frame link has noncanonical data.');
      bytes[target++] = value >>> 8;
      bytes[target++] = value & 255;
    }
  }
  return bytes;
}

function fourCC(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** Accept only bounded, opaque still frames written by our lossy encoder.
 * The single VP8 chunk excludes animation, transparency, and metadata. Full
 * entropy decoding remains the browser image decoder's job.
 */
export function inspectWebp(value) {
  const bytes = asBytes(value);
  if (bytes.length < 30 || bytes.length > MAX_WEBP_BYTES) throw new Error('This frame is empty or too large.');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') throw new Error('This frame is not a WebP image.');
  if (data.getUint32(4, true) + 8 !== bytes.length) throw new Error('This WebP has an invalid file length.');
  if (fourCC(bytes, 12) !== 'VP8 ') throw new Error('Only a simple still WebP frame is supported.');
  const chunkLength = data.getUint32(16, true);
  const padding = chunkLength % 2;
  if (chunkLength < 10 || 20 + chunkLength + padding !== bytes.length) throw new Error('This WebP has an invalid image chunk.');
  if (padding && bytes.at(-1) !== 0) throw new Error('This WebP has invalid padding.');
  const tag = bytes[20] | (bytes[21] << 8) | (bytes[22] << 16);
  if ((tag & 1) || !(tag & 16) || ((tag >>> 1) & 7) > 3
      || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
    throw new Error('This WebP has no supported VP8 key frame.');
  }
  const partitionLength = tag >>> 5;
  if (!partitionLength || partitionLength > chunkLength - 10) throw new Error('This WebP has a truncated image partition.');
  const width = data.getUint16(26, true) & 0x3fff;
  const height = data.getUint16(28, true) & 0x3fff;
  if (!width || width !== height || width > MAX_WEBP_EDGE) throw new Error('This frame has unsupported dimensions.');
  return { width, height, bytes: bytes.length };
}

export function buildWebpFrameUrl(baseUrl, value) {
  const bytes = asBytes(value);
  inspectWebp(bytes);
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Frames need an HTTP or HTTPS viewer URL.');
  url.search = '';
  url.hash = `q=2.${encodeBase43(bytes)}`;
  return url.href;
}

export function parseWebpFrameHash(hash) {
  if (hash === '' || hash === '#') return null;
  if (typeof hash !== 'string' || hash.length > MAX_PAYLOAD_LENGTH + 5) throw new Error('This frame link is too large.');
  const match = /^#?q=2\.(.+)$/.exec(hash);
  if (!match) throw new Error('This frame link is incomplete or unsupported.');
  const bytes = decodeBase43(match[1]);
  const dimensions = inspectWebp(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { ...dimensions, mimeType: 'image/webp', extension: 'webp', dataUrl: `data:image/webp;base64,${btoa(binary)}` };
}

/** Separate the normal URL prefix from the dense QR alphanumeric payload. */
export function webpQrSegments(url) {
  if (typeof url !== 'string') return null;
  const marker = url.indexOf('#q=2.');
  if (marker < 0) return null;
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Frames need an HTTP or HTTPS viewer URL.');
  const prefix = url.slice(0, marker + 5);
  const payload = url.slice(marker + 5);
  if (!payload) throw new Error('This frame link is incomplete.');
  // Validate the alphabet, length, and canonical groups before QR encoding.
  decodeBase43(payload);
  return [{ data: prefix, mode: 'byte' }, { data: payload, mode: 'alphanumeric' }];
}
