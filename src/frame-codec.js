import QRCode from 'qrcode';
import { encodeWebp } from './webp-encoder.js';
import { buildWebpFrameUrl, parseWebpFrameHash, webpQrSegments, MAX_WEBP_BYTES } from './webp-payload.js';

// WebP uses compact alphanumeric QR segments: character count is no longer
// byte-mode capacity. These budgets fit version 33 / 40 at the public URL.
export const DEFAULT_URL_BUDGET = 2960;
export const FINE_URL_BUDGET = 4240;
export const MAX_URL_BUDGET = FINE_URL_BUDGET;
export const MAX_JPEG_BYTES = 2200;
export const MAX_FRAME_EDGE = 256;

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('Expected JPEG bytes.');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Read only a bounded, square JPEG. No SVG, HTML, or arbitrary data URLs. */
export function inspectJpeg(value) {
  const bytes = asBytes(value);
  if (bytes.length < 16 || bytes.length > MAX_JPEG_BYTES) {
    throw new Error('This frame is empty or too large.');
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new Error('This frame is not a complete JPEG.');
  }

  let offset = 2;
  let dimensions = null;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error('Truncated JPEG marker.');
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) {
      throw new Error('Truncated JPEG segment.');
    }
    // Canvas JPEG exports are baseline or progressive DCT.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) throw new Error('Invalid JPEG dimensions.');
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (!width || width !== height || width > MAX_FRAME_EDGE) {
        throw new Error('This frame has unsupported dimensions.');
      }
      dimensions = { width, height };
    }
    if (marker === 0xda) {
      if (!dimensions) throw new Error('JPEG dimensions are missing.');
      return { ...dimensions, bytes: bytes.length };
    }
    offset += length;
  }
  throw new Error('This JPEG has no image scan.');
}

/** Remove camera/browser metadata before budgeting and sharing the frame. */
function stripMetadata(bytes) {
  const chunks = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const start = offset;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    // Keep the scan and the rest of the encoded entropy stream untouched.
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.subarray(start));
      offset = bytes.length;
      break;
    }
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return bytes;
    offset += length;
    // Preserve JFIF and Adobe color-space markers, remove EXIF/ICC/comments.
    if (!(marker === 0xfe || (marker >= 0xe1 && marker <= 0xed) || marker === 0xef)) {
      chunks.push(bytes.subarray(start, offset));
    }
  }
  if (offset < bytes.length) chunks.push(bytes.subarray(offset));
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.length; }
  return output;
}

export function buildFrameUrl(baseUrl, value) {
  const bytes = asBytes(value);
  inspectJpeg(bytes);
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Frames need an HTTP or HTTPS viewer URL.');
  }
  url.search = '';
  const payload = bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  url.hash = `q=1.${payload}`;
  return url.href;
}

/** An empty hash means camera mode; an invalid nonempty hash is an error. */
export function parseFrameHash(hash) {
  if (!hash || hash === '#') return null;
  if (typeof hash === 'string' && /^#?q=2\./.test(hash)) return parseWebpFrameHash(hash);
  if (typeof hash !== 'string' || hash.length > Math.ceil(MAX_JPEG_BYTES * 4 / 3) + 10) {
    throw new Error('This frame link is too large.');
  }
  const match = /^#?q=1\.([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match || match[1].length % 4 === 1) throw new Error('This frame link is incomplete or unsupported.');
  const base64 = match[1].replaceAll('-', '+').replaceAll('_', '/');
  let binary;
  try { binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')); }
  catch { throw new Error('This frame link is damaged.'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  // Reject noncanonical trailing bits as well as malformed alphabets.
  if (bytesToBase64(bytes).replace(/=+$/, '') !== base64) throw new Error('This frame link is damaged.');
  const dimensions = inspectJpeg(bytes);
  return { ...dimensions, mimeType: 'image/jpeg', extension: 'jpg', dataUrl: `data:image/jpeg;base64,${bytesToBase64(bytes)}` };
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode this camera frame.')), 'image/jpeg', quality);
  });
}

/** Encode an already-filtered canvas. Crops its center to a 1:1 frame. */
async function encodeJpegFrame(source, baseUrl, options = {}) {
  const budget = Math.min(2300, Math.max(900, options.maxUrlLength ?? DEFAULT_URL_BUDGET));
  const initialSize = Math.round(Math.min(MAX_FRAME_EDGE, Math.max(24, options.size ?? 96)));
  const initialQuality = Math.min(0.9, Math.max(0.12, options.quality ?? 0.42));
  if (!source.width || !source.height) throw new Error('The camera frame is not ready.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  const sourceEdge = Math.min(source.width, source.height);
  const sizes = [...new Set([initialSize, 80, 64, 48, 32, 24].filter(size => size <= initialSize))];
  const qualities = [...new Set([initialQuality, 0.30, 0.20, 0.12].filter(quality => quality <= initialQuality))];

  for (const size of sizes) {
    canvas.width = canvas.height = size;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, (source.width - sourceEdge) / 2, (source.height - sourceEdge) / 2,
      sourceEdge, sourceEdge, 0, 0, size, size);
    for (const quality of qualities) {
      const blob = await canvasBlob(canvas, quality);
      if (blob.type !== 'image/jpeg') throw new Error('This browser cannot export JPEG frames.');
      const bytes = stripMetadata(new Uint8Array(await blob.arrayBuffer()));
      if (bytes.length > MAX_JPEG_BYTES) continue;
      const url = buildFrameUrl(baseUrl, bytes);
      if (url.length <= budget) {
        return { url, dataUrl: `data:image/jpeg;base64,${bytesToBase64(bytes)}`, mimeType: 'image/jpeg', extension: 'jpg',
          width: size, height: size, bytes: bytes.length, quality };
      }
    }
  }
  throw new Error('This frame cannot fit in a QR yet. Try a simpler scene or the detail setting.');
}

let webpUnavailable = false;

/** Keep a useful compression quality before trading away spatial detail.
 * Encoding runs off the UI thread; old JPEG links and a JPEG failure fallback
 * remain available without changing camera startup or controls.
 */
export async function encodeFrame(source, baseUrl, options = {}) {
  if (webpUnavailable) return encodeJpegFrame(source, baseUrl, options);
  if (!source.width || !source.height) throw new Error('The camera frame is not ready.');
  const budget = Math.min(MAX_URL_BUDGET, Math.max(900, options.maxUrlLength ?? DEFAULT_URL_BUDGET));
  const initialSize = Math.round(Math.min(384, source.width, source.height, Math.max(24, options.size ?? 192)));
  const viewer = new URL(baseUrl); viewer.search = ''; viewer.hash = 'q=2.';
  const byteBudget = Math.min(MAX_WEBP_BYTES, Math.floor((budget - viewer.href.length) * 2 / 3));
  if (byteBudget < 100) throw new Error('The viewer URL leaves no room for an image.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  const sourceEdge = Math.min(source.width, source.height);
  const sizes = [...new Set([initialSize, 256, 224, 192, 176, 160, 144, 128, 112, 96, 80, 64, 48, 32, 24].filter(size => size <= initialSize))];
  const maxQuality = Math.round(Math.min(90, Math.max(32, (options.quality ?? 0.85) * 100)));
  for (const size of sizes) {
    canvas.width = canvas.height = size;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(source, (source.width - sourceEdge) / 2, (source.height - sourceEdge) / 2,
      sourceEdge, sourceEdge, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    let bytes;
    const encode = quality => encodeWebp(pixels, { quality, method: 4, pass: 1, use_sharp_yuv: 1 });
    try { bytes = await encode(32); }
    catch {
      // A missing/unsupported worker or WASM must not take away the camera.
      webpUnavailable = true;
      return encodeJpegFrame(source, baseUrl, options);
    }
    if (bytes.length > byteBudget) continue;
    let best = bytes, quality = 32, low = 32, high = maxQuality;
    // Use the remaining space for image detail instead of stopping at the
    // first low-quality image that happens to fit.
    for (let attempt = 0; attempt < 4 && low < high; attempt++) {
      const candidateQuality = Math.ceil((low + high) / 2);
      let candidate;
      try { candidate = await encode(candidateQuality); }
      catch {
        webpUnavailable = true;
        return encodeJpegFrame(source, baseUrl, options);
      }
      if (candidate.length <= byteBudget) { best = candidate; quality = candidateQuality; low = candidateQuality; }
      else high = candidateQuality - 1;
    }
    const url = buildWebpFrameUrl(baseUrl, best);
    if (url.length > budget) continue;
    return { ...parseWebpFrameHash(new URL(url).hash), url, quality: quality / 100 };
  }
  throw new Error('This frame cannot fit in a QR yet. Try a simpler scene or the detail setting.');
}

/** Draw at an integer module scale, with a standards-compliant quiet zone. */
export function renderQr(canvas, url, { scale = 4, fitToPixels } = {}) {
  if (typeof url !== 'string' || url.length > MAX_URL_BUDGET) throw new Error('This frame URL is too large for a QR.');
  const qr = QRCode.create(webpQrSegments(url) || [{ data: url, mode: 'byte' }], { errorCorrectionLevel: 'L' });
  const modules = qr.modules.size;
  const margin = 4;
  const moduleExtent = modules + margin * 2;
  if (fitToPixels !== undefined && (!Number.isFinite(fitToPixels) || fitToPixels < moduleExtent)) {
    throw new Error('This QR needs more display pixels. Try standard detail.');
  }
  // Never resize this bitmap by a fractional display scale. fitToPixels is the
  // available *physical* width; the caller displays size / devicePixelRatio CSS px.
  const pixelScale = Math.min(12, Math.max(1, fitToPixels === undefined
    ? Math.round(scale) : Math.floor(fitToPixels / moduleExtent)));
  canvas.width = canvas.height = moduleExtent * pixelScale;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (qr.modules.get(y, x)) context.fillRect((x + margin) * pixelScale, (y + margin) * pixelScale, pixelScale, pixelScale);
    }
  }
  return { version: qr.version, modules, size: canvas.width };
}
