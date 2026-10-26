import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { buildFrameUrl, parseFrameHash, inspectJpeg, renderQr, MAX_JPEG_BYTES, DEFAULT_URL_BUDGET, FINE_URL_BUDGET, MAX_URL_BUDGET } from '../src/frame-codec.js';
import { buildWebpFrameUrl, encodeBase43 } from '../src/webp-payload.js';

// Original 16 × 16 RGB gradient, encoded as JPEG using Pillow. No camera data.
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABcQERQRDhcUEhQaGBcbIjklIh8fIkYyNSk5UkhXVVFIUE5bZoNvW2F8Yk5QcptzfIeLkpSSWG2grJ+OqoOPko3/2wBDARgaGiIeIkMlJUONXlBejY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY3/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAABAX/xAAXEAADAQAAAAAAAAAAAAAAAAAAAwRh/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAH/xAAWEQADAAAAAAAAAAAAAAAAAAAAAwT/2gAMAwEAAhEDEQA/AJKpcGqlwaqXBqpcKx4kpP/Z', 'base64'));

// Original 16 × 16 RGB gradient, independently encoded with Pillow/libwebp.
const WEBP = Uint8Array.from(Buffer.from('UklGRkgAAABXRUJQVlA4IDwAAADwAQCdASoQABAAAoBCJbACdAEPDBLy5EAA/vsZBsnxPTJas0jWa4QBwSAnXftIX/n1vC/8TqZX8wIAAAA=', 'base64'));

function rasterCanvas() {
  let pixels;
  const canvas = {
    width: 0, height: 0,
    getContext() {
      pixels = new Uint8ClampedArray(this.width * this.height * 4);
      const width = this.width;
      return {
        fillStyle: '',
        fillRect(x, y, w, h) {
          const value = this.fillStyle === '#ffffff' ? 255 : 0;
          for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
            const index = (row * width + col) * 4;
            pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
            pixels[index + 3] = 255;
          }
        },
      };
    },
  };
  return { canvas, get pixels() { return pixels; } };
}

// A deterministic imaging approximation, not a physical-camera test: bilinear
// resampling followed by a mild separable [1, 6, 1] / 8 blur.
function downsampleAndBlur(pixels, sourceSize, targetSize = 600) {
  const resized = new Float32Array(targetSize * targetSize);
  for (let y = 0; y < targetSize; y++) for (let x = 0; x < targetSize; x++) {
    const sx = Math.max(0, Math.min(sourceSize - 1, (x + 0.5) * sourceSize / targetSize - 0.5));
    const sy = Math.max(0, Math.min(sourceSize - 1, (y + 0.5) * sourceSize / targetSize - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, sourceSize - 1), y1 = Math.min(y0 + 1, sourceSize - 1);
    const dx = sx - x0, dy = sy - y0;
    const top = pixels[(y0 * sourceSize + x0) * 4] * (1 - dx) + pixels[(y0 * sourceSize + x1) * 4] * dx;
    const bottom = pixels[(y1 * sourceSize + x0) * 4] * (1 - dx) + pixels[(y1 * sourceSize + x1) * 4] * dx;
    resized[y * targetSize + x] = top * (1 - dy) + bottom * dy;
  }
  const horizontal = new Float32Array(resized.length);
  for (let y = 0; y < targetSize; y++) for (let x = 0; x < targetSize; x++) {
    const index = y * targetSize + x;
    horizontal[index] = (resized[y * targetSize + Math.max(0, x - 1)] + resized[index] * 6 + resized[y * targetSize + Math.min(targetSize - 1, x + 1)]) / 8;
  }
  const result = new Uint8ClampedArray(resized.length * 4);
  for (let y = 0; y < targetSize; y++) for (let x = 0; x < targetSize; x++) {
    const index = y * targetSize + x;
    const value = (horizontal[Math.max(0, y - 1) * targetSize + x] + horizontal[index] * 6 + horizontal[Math.min(targetSize - 1, y + 1) * targetSize + x]) / 8;
    result[index * 4] = result[index * 4 + 1] = result[index * 4 + 2] = value;
    result[index * 4 + 3] = 255;
  }
  return result;
}

// Original 48 × 48 texture: exercises nearly the full standard URL budget.
const DENSE_JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAAwADADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAABAMCAf/EACwQAAIBBAECBAUFAQAAAAAAAAECAwAEESExEkEFE2FxIlGBkdEUIzJC8PH/xAAWAQEBAQAAAAAAAAAAAAAAAAACAQP/xAAeEQACAgMAAwEAAAAAAAAAAAABAgASAxEhEyIxUf/aAAwDAQACEQMRAD8APaeH8ap88C28GyFz/YnGBUBczlCRiNBn+I39/wDlHNvLcSB5WZ2PcnNRQ3iJYytZAFJ0TFQS2sfBLkHGFFTvL+ZiIoEWPIHUeSKTDZiKMtjfb3o4a2Ry7SqxOThd5+1Q1oOb7Cap6KNkzMUE05Hmuzd8dvtXWtut+gDQO/U1aXxAxRHyIcE/xL+3yocQuZ9O5CnPwroYPb1+tN7Gu+CJrgeMc/YqW6tQ/lqxcKcEKvf3Pas/qZnYCKNY9DfJrVn4fxqu3U1rAOgSKxYcJs69qDVGMKvewoV2chG4aQTXkg8x2ZBwOB74pFtYgAsRgcmspdnB8iED1f8AA/NSuJLmfERkYL/ZV0N9vX608gYlEHBEtwpyNyXmWFctM6rxgd8Z+VaS9hhHUkLOByTr7VGGw0o6atJCikKzKiA4y2smo1WzV+6gFcal2OyZMJK6dczsw5Ck6z7VK3sjI5dhtjmqT+IGRitvDhF4Lnn6D81mMXEw+OQhd6Ghj/fOrksAo+TT3yNUcURkwgsoCZXRWOOlTyfpzQ4buMN+3C0m9knGay1qZXGvhzqnQ2sUCdczLGvzY4qNUZNHpg9Hbp2BCXV1dFQisIyw4TRHrnmsW1kzt1OSzHknZrT3lu05ZVeQ41gaHpurfrJljLoqxgbHcn0/wpoWuSBqIWc7A0BP/9k=', 'base64'));

test('frame URL carries the complete JPEG and removes camera/demo query state', () => {
  const url = new URL(buildFrameUrl('https://taewooopark.github.io/QameRa/?demo=1#old', JPEG));
  assert.equal(url.pathname, '/QameRa/');
  assert.equal(url.search, '');
  const frame = parseFrameHash(url.hash);
  assert.equal(frame.width, 16);
  assert.equal(frame.height, 16);
  assert.equal(frame.bytes, JPEG.length);
  assert.equal(frame.mimeType, 'image/jpeg');
  assert.equal(frame.extension, 'jpg');
  assert.deepEqual(Buffer.from(frame.dataUrl.split(',')[1], 'base64'), Buffer.from(JPEG));
});

test('camera mode is only selected by an empty fragment', () => {
  assert.equal(parseFrameHash(''), null);
  assert.equal(parseFrameHash('#'), null);
  assert.throws(() => parseFrameHash('#q=2.AAAA'), /incomplete|unsupported/);
  assert.throws(() => parseFrameHash('#q=1.A'), /incomplete|unsupported/);
  assert.throws(() => parseFrameHash('#q=1.<svg>'), /incomplete|unsupported/);
  assert.throws(() => parseFrameHash('#q=1.AAAA&x=1'), /incomplete|unsupported/);
});

test('rejects oversized, truncated, non-JPEG and decompression-bomb inputs', () => {
  assert.throws(() => inspectJpeg(new Uint8Array(MAX_JPEG_BYTES + 1)), /too large/);
  assert.throws(() => parseFrameHash('#q=1.' + 'A'.repeat(4000)), /too large/);
  assert.throws(() => inspectJpeg(JPEG.slice(0, -1)), /complete JPEG/);
  assert.throws(() => inspectJpeg(new TextEncoder().encode('<svg onload="alert(1)"></svg>')), /complete JPEG/);
  const huge = JPEG.slice();
  const sof = huge.findIndex((value, index) => value === 0xff && huge[index + 1] === 0xc0);
  huge[sof + 5] = 0x7f;
  huge[sof + 6] = 0xff;
  huge[sof + 7] = 0x7f;
  huge[sof + 8] = 0xff;
  assert.throws(() => inspectJpeg(huge), /dimensions/);
  assert.throws(() => buildFrameUrl('javascript:alert(1)', JPEG), /HTTP/);
});

test('rendered QR is independently decodable and yields the original image', () => {
  const url = buildFrameUrl('https://taewooopark.github.io/QameRa/', JPEG);
  let pixels;
  const canvas = {
    width: 0, height: 0,
    getContext() {
      pixels = new Uint8ClampedArray(this.width * this.height * 4);
      const width = this.width;
      return {
        fillStyle: '',
        fillRect(x, y, w, h) {
          const value = this.fillStyle === '#ffffff' ? 255 : 0;
          for (let row = y; row < y + h; row++) {
            for (let col = x; col < x + w; col++) {
              const index = (row * width + col) * 4;
              pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
              pixels[index + 3] = 255;
            }
          }
        },
      };
    },
  };
  const metadata = renderQr(canvas, url);
  assert.equal(canvas.width, (metadata.modules + 8) * 4);
  const decoded = jsQR(pixels, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
  assert.ok(decoded, 'An independent reader must find the QR');
  assert.equal(decoded.data, url);
  assert.equal(parseFrameHash(new URL(decoded.data).hash).bytes, JPEG.length);
  // Corner pixels must remain white to preserve the quiet zone.
  assert.equal(pixels[0], 255);
  assert.equal(pixels[(canvas.width * 16 - 1) * 4], 255);
});

test('legacy detailed byte URLs still fit and the current transport limit rejects oversized URLs', () => {
  const qr = QRCode.create([{ data: 'https://example.com/#q=1.' + 'a'.repeat(2276), mode: 'byte' }], { errorCorrectionLevel: 'L' });
  assert.ok(qr.version <= 40);
  assert.throws(() => renderQr({}, 'a'.repeat(MAX_URL_BUDGET + 1)), /too large/);
});

test('a legacy near-budget JPEG frame still decodes at a 374-pixel display width', () => {
  const url = buildFrameUrl('https://taewooopark.github.io/QameRa/', DENSE_JPEG);
  assert.ok(url.length > 1100 && url.length <= 1150);
  let pixels;
  const canvas = {
    width: 0, height: 0,
    getContext() {
      pixels = new Uint8ClampedArray(this.width * this.height * 4);
      const width = this.width;
      return {
        fillStyle: '',
        fillRect(x, y, w, h) {
          const value = this.fillStyle === '#ffffff' ? 255 : 0;
          for (let row = y; row < y + h; row++) {
            for (let col = x; col < x + w; col++) {
              const index = (row * width + col) * 4;
              pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
              pixels[index + 3] = 255;
            }
          }
        },
      };
    },
  };
  const metadata = renderQr(canvas, url, { fitToPixels: 374 });
  assert.ok(metadata.size <= 374);
  assert.equal(metadata.size % (metadata.modules + 8), 0);
  assert.ok(metadata.size / (metadata.modules + 8) >= 3, 'Standard mode retains at least 3 physical pixels per module');
  const decoded = jsQR(pixels, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
  assert.ok(decoded, 'Actual display-size pixels must decode independently');
  assert.equal(decoded.data, url);
  assert.deepEqual(Buffer.from(parseFrameHash(new URL(decoded.data).hash).dataUrl.split(',')[1], 'base64'), Buffer.from(DENSE_JPEG));
  assert.throws(() => renderQr(canvas, url, { fitToPixels: 10 }), /more display pixels/);
});

test('a mixed-segment WebP QR reconstructs the exact image and keeps its MIME type', () => {
  const url = buildWebpFrameUrl('https://taewooopark.github.io/QameRa/?demo=1', WEBP);
  const raster = rasterCanvas();
  const metadata = renderQr(raster.canvas, url, { fitToPixels: 1122 });
  const decoded = jsQR(raster.pixels, metadata.size, metadata.size, { inversionAttempts: 'dontInvert' });
  assert.ok(decoded, 'An independent QR decoder must read the WebP URL');
  assert.equal(decoded.data, url, 'Mixed byte/alphanumeric segments must retain the URL exactly');
  const frame = parseFrameHash(new URL(decoded.data).hash);
  assert.equal(frame.mimeType, 'image/webp');
  assert.equal(frame.extension, 'webp');
  assert.equal(frame.width, 16);
  assert.equal(frame.height, 16);
  assert.deepEqual(Buffer.from(frame.dataUrl.split(',')[1], 'base64'), Buffer.from(WEBP));
});

test('near-budget mixed QR transport decodes at iPhone pixel sizing and smaller module-aligned rasters', () => {
  const prefix = 'https://taewooopark.github.io/QameRa/#q=2.';
  for (const [budget, expectedVersion] of [[DEFAULT_URL_BUDGET, 33], [FINE_URL_BUDGET, 40]]) {
    // These bytes exercise transport capacity; they are deliberately not an image
    // fixture and must not be passed to the image parser.
    const bytes = new Uint8Array(Math.floor((budget - prefix.length) * 2 / 3));
    let random = 0x12345678;
    for (let index = 0; index < bytes.length; index++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      bytes[index] = random & 255;
    }
    const url = prefix + encodeBase43(bytes);
    assert.ok(url.length <= budget && budget - url.length <= 2);
    const raster = rasterCanvas();
    const metadata = renderQr(raster.canvas, url, { fitToPixels: 374 * 3 });
    assert.equal(metadata.version, expectedVersion);
    assert.ok(metadata.size <= 1122);
    assert.equal(metadata.size % (metadata.modules + 8), 0);
    assert.ok(metadata.size / (metadata.modules + 8) >= 6);
    const clean = jsQR(raster.pixels, metadata.size, metadata.size, { inversionAttempts: 'dontInvert' });
    assert.ok(clean, `Version ${expectedVersion} must decode at actual display pixel size`);
    assert.equal(clean.data, url);
    // Controlled 3/4-pixel modules check decoder recovery after blur. This is
    // not evidence of tolerance to arbitrary camera scaling or perspective.
    for (const edge of [(metadata.modules + 8) * 3, (metadata.modules + 8) * 4]) {
      const degraded = downsampleAndBlur(raster.pixels, metadata.size, edge);
      const photographed = jsQR(degraded, edge, edge, { inversionAttempts: 'dontInvert' });
      assert.ok(photographed, `Version ${expectedVersion} must decode at ${edge}px after mild blur`);
      assert.equal(photographed.data, url);
    }
  }
});
