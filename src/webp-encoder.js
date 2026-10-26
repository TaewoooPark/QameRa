const ENCODE_TIMEOUT_MS = 10000;
let worker = null;
let nextRequestId = 0;
const requests = new Map();

function encoderError(name, message) {
  return Object.assign(new Error(message), { name });
}

function stopFailedWorker(instance, error) {
  if (worker === instance) worker = null;
  instance.terminate();
  for (const [id, request] of requests) {
    if (request.worker !== instance) continue;
    clearTimeout(request.timer);
    requests.delete(id);
    request.reject(error);
  }
}

function getWorker() {
  if (worker) return worker;
  const instance = new Worker(new URL('./webp-encoder.worker.js', import.meta.url), { type: 'module' });
  instance.onmessage = ({ data }) => {
    const request = requests.get(data?.id);
    if (!request || request.worker !== instance) return;
    if (data.error) {
      stopFailedWorker(instance, encoderError(data.error.name || 'WebPEncodingError', data.error.message || 'WebP encoding failed.'));
      return;
    }
    if (!(data.buffer instanceof ArrayBuffer) || !data.buffer.byteLength) {
      stopFailedWorker(instance, encoderError('WebPEncodingError', 'The WebP encoder returned an empty image.'));
      return;
    }
    clearTimeout(request.timer);
    requests.delete(data.id);
    request.resolve(new Uint8Array(data.buffer));
  };
  instance.onerror = event => {
    event.preventDefault();
    stopFailedWorker(instance, encoderError('WebPWorkerError', event.message || 'The WebP encoder could not start.'));
  };
  instance.onmessageerror = () => {
    stopFailedWorker(instance, encoderError('WebPWorkerError', 'The WebP encoder response could not be read.'));
  };
  worker = instance;
  return instance;
}

/** Copy pixel data before transfer so callers can reuse it for quality trials.
 * The worker and its WASM module are created only on the first actual encode.
 */
export async function encodeWebp(imageData, options = {}) {
  const { width, height, data } = imageData || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !(data instanceof Uint8ClampedArray || data instanceof Uint8Array) || data.length !== width * height * 4) {
    throw new TypeError('WebP encoding requires complete RGBA image data.');
  }
  const pixels = new Uint8ClampedArray(data);
  const instance = getWorker();
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stopFailedWorker(instance, encoderError('WebPEncodingTimeout', 'The WebP encoder did not finish within 10 seconds.'));
    }, ENCODE_TIMEOUT_MS);
    requests.set(id, { worker: instance, resolve, reject, timer });
    try {
      instance.postMessage({ id, width, height, pixels: pixels.buffer, options }, [pixels.buffer]);
    } catch (error) {
      stopFailedWorker(instance, error);
    }
  });
}
