import encode, { init } from '@jsquash/webp/encode.js';
import baselineWasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdWasmUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';

let initialization;
function ready() {
  if (!initialization) {
    initialization = init(undefined, {
      locateFile: path => path.endsWith('webp_enc_simd.wasm') ? simdWasmUrl : baselineWasmUrl,
    });
  }
  return initialization;
}

self.onmessage = async ({ data: request }) => {
  try {
    await ready();
    const imageData = {
      width: request.width,
      height: request.height,
      data: new Uint8ClampedArray(request.pixels),
    };
    const buffer = await encode(imageData, { ...request.options, thread_level: 0 });
    self.postMessage({ id: request.id, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ id: request.id, error: {
      name: error?.name || 'WebPEncodingError',
      message: String(error?.message || error || 'WebP encoding failed.'),
    } });
  }
};
