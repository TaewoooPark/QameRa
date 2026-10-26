import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {
  WEBP_ALPHABET, MAX_WEBP_BYTES, MAX_WEBP_EDGE, encodeBase43, decodeBase43,
  inspectWebp, buildWebpFrameUrl, parseWebpFrameHash, webpQrSegments,
} from '../src/webp-payload.js';

// Original opaque 16 × 16 RGB gradient, encoded with Pillow/libwebp at quality60.
const WEBP = Uint8Array.from(Buffer.from('UklGRkgAAABXRUJQVlA4IDwAAADwAQCdASoQABAAAoBCJbACdAEPDBLy5EAA/vsZBsnxPTJas0jWa4QBwSAnXftIX/n1vC/8TqZX8wIAAAA=', 'base64'));
const BASE = 'https://taewooopark.github.io/QameRa/';

test('base43 uses only URL-safe QR alphanumeric characters and canonical fixed groups', () => {
  assert.equal(WEBP_ALPHABET.length, 43);
  assert.equal(new Set(WEBP_ALPHABET).size, 43);
  assert.equal(encodeBase43(new Uint8Array([0])), '00');
  assert.equal(encodeBase43(new Uint8Array([255])), '5.');
  assert.equal(encodeBase43(new Uint8Array([0, 0])), '000');
  assert.equal(encodeBase43(new Uint8Array([0, 43])), '010');
  const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (const bytes of [new Uint8Array(), allBytes, allBytes.subarray(1), WEBP]) {
    const payload = encodeBase43(bytes);
    assert.ok([...payload].every(character => WEBP_ALPHABET.includes(character)));
    assert.deepEqual(decodeBase43(payload), bytes);
    assert.equal(encodeBase43(decodeBase43(payload)), payload);
    assert.equal(new URL(BASE + '#q=2.' + payload).hash, '#q=2.' + payload, 'URL serialization must preserve every payload character');
  }
});

test('base43 rejects impossible lengths, overflow, unsupported characters, and oversized payloads', () => {
  for (const text of ['0', '0000', 'a0', '%0', ' 0', '_0', '\n0', '::', ':::']) assert.throws(() => decodeBase43(text));
  assert.throws(() => encodeBase43(new Uint8Array(MAX_WEBP_BYTES + 1)), /large/);
  assert.throws(() => decodeBase43('0'.repeat(4202)), /large/);
  assert.deepEqual(decodeBase43(encodeBase43(new Uint8Array(MAX_WEBP_BYTES))), new Uint8Array(MAX_WEBP_BYTES));
});

test('WebP frame URLs preserve actual bytes, remove demo state, and report the correct image type', () => {
  assert.deepEqual(inspectWebp(WEBP), { width: 16, height: 16, bytes: WEBP.length });
  const url = new URL(buildWebpFrameUrl(BASE + '?demo=1#old', WEBP));
  assert.equal(url.search, '');
  assert.equal(url.pathname, '/QameRa/');
  const frame = parseWebpFrameHash(url.hash);
  assert.equal(frame.width, 16);
  assert.equal(frame.height, 16);
  assert.equal(frame.mimeType, 'image/webp');
  assert.equal(frame.extension, 'webp');
  assert.deepEqual(Buffer.from(frame.dataUrl.split(',')[1], 'base64'), Buffer.from(WEBP));
  assert.equal(parseWebpFrameHash(''), null);
  assert.equal(parseWebpFrameHash('#'), null);
  assert.throws(() => parseWebpFrameHash('#q=1.' + encodeBase43(WEBP)), /unsupported/);
  assert.throws(() => parseWebpFrameHash('#q=2.'), /incomplete/);
  assert.throws(() => buildWebpFrameUrl('javascript:alert(1)', WEBP), /HTTP/);
});

test('WebP inspection rejects truncation, trailing chunks, animation, and misleading dimensions', () => {
  assert.throws(() => inspectWebp(WEBP.slice(0, -1)), /length/);
  assert.throws(() => inspectWebp(new Uint8Array(MAX_WEBP_BYTES + 1)), /large/);
  for (const marker of ['VP8X', 'VP8L', 'ANIM', 'ANMF']) {
    const bytes = WEBP.slice(); bytes.set(new TextEncoder().encode(marker), 12);
    assert.throws(() => inspectWebp(bytes), /simple still/);
  }
  const trailing = new Uint8Array(WEBP.length + 8); trailing.set(WEBP);
  new DataView(trailing.buffer).setUint32(4, trailing.length - 8, true);
  assert.throws(() => inspectWebp(trailing), /chunk/);
  for (const [width, height] of [[0, 0], [16, 17], [MAX_WEBP_EDGE + 1, MAX_WEBP_EDGE + 1], [16383, 16383]]) {
    const bytes = WEBP.slice(); const data = new DataView(bytes.buffer);
    data.setUint16(26, width, true); data.setUint16(28, height, true);
    assert.throws(() => inspectWebp(bytes), /dimensions/);
  }
  const bombHash = '#q=2.' + encodeBase43(WEBP.map((value, index) => [26, 27, 28, 29].includes(index) ? 255 : value));
  assert.throws(() => parseWebpFrameHash(bombHash), /dimensions/);
});

test('WebP inspection validates padding and key-frame boundaries', () => {
  const badKey = WEBP.slice(); badKey[20] |= 1;
  assert.throws(() => inspectWebp(badKey), /key frame/);
  const badSignature = WEBP.slice(); badSignature[23] = 0;
  assert.throws(() => inspectWebp(badSignature), /key frame/);
  const badPartition = WEBP.slice(); badPartition[21] = badPartition[22] = 255;
  assert.throws(() => inspectWebp(badPartition), /partition/);
  // Header-level odd-chunk fixture; the browser remains responsible for entropy decoding.
  const odd = WEBP.slice(); new DataView(odd.buffer).setUint32(16, 59, true);
  assert.equal(inspectWebp(odd).bytes, WEBP.length);
  odd[odd.length - 1] = 1;
  assert.throws(() => inspectWebp(odd), /padding/);
});

test('mixed QR segments preserve the URL and fit standard/fine payload targets', () => {
  const url = buildWebpFrameUrl(BASE, WEBP);
  const segments = webpQrSegments(url);
  assert.deepEqual(segments.map(segment => segment.mode), ['byte', 'alphanumeric']);
  assert.equal(segments.map(segment => segment.data).join(''), url);
  assert.equal(webpQrSegments(BASE), null);
  assert.equal(webpQrSegments(BASE + '#q=1.AAAA'), null);
  assert.throws(() => webpQrSegments(BASE + '#q=2.a0'), /damaged/);
  for (const [bytes, maxVersion] of [[1950, 33], [2800, 40]]) {
    const denseUrl = BASE + '#q=2.' + encodeBase43(new Uint8Array(bytes).fill(137));
    const qr = QRCode.create(webpQrSegments(denseUrl), { errorCorrectionLevel: 'L' });
    assert.ok(qr.version <= maxVersion, `${bytes} bytes must fit QR version ${maxVersion}`);
  }
});
