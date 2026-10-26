import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { buildFrameUrl, parseFrameHash, inspectJpeg, renderQr, MAX_JPEG_BYTES, DEFAULT_URL_BUDGET } from '../src/frame-codec.js';

// Original 16 × 16 RGB gradient, encoded as JPEG using Pillow. No camera data.
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABcQERQRDhcUEhQaGBcbIjklIh8fIkYyNSk5UkhXVVFIUE5bZoNvW2F8Yk5QcptzfIeLkpSSWG2grJ+OqoOPko3/2wBDARgaGiIeIkMlJUONXlBejY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY3/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAABAX/xAAXEAADAQAAAAAAAAAAAAAAAAAAAwRh/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAH/xAAWEQADAAAAAAAAAAAAAAAAAAAAAwT/2gAMAwEAAhEDEQA/AJKpcGqlwaqXBqpcKx4kpP/Z', 'base64'));

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

test('the detailed URL budget fits a standard QR and oversized URLs are rejected', () => {
  const qr = QRCode.create([{ data: 'https://example.com/#q=1.' + 'a'.repeat(2276), mode: 'byte' }], { errorCorrectionLevel: 'L' });
  assert.ok(qr.version <= 40);
  assert.throws(() => renderQr({}, 'a'.repeat(2301)), /too large/);
});

test('a near-budget frame decodes at the actual 374-pixel mobile display width', () => {
  const url = buildFrameUrl('https://taewooopark.github.io/QameRa/', DENSE_JPEG);
  assert.ok(url.length > 1100 && url.length <= DEFAULT_URL_BUDGET);
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
