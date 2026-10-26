import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCameraActivation, requestCamera, playCamera, describeCameraFailure, cameraEnvironment, readCameraPermission } from '../src/camera.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function streamFixture() {
  const tracks = [{ stops: 0, stop() { this.stops++; } }, { stops: 0, stop() { this.stops++; } }];
  return { tracks, getTracks: () => tracks };
}
class VideoFixture extends EventTarget {
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  paused = true;
  playCalls = 0;
  listeners = new Set();
  playResult = () => Promise.resolve();
  play() { this.playCalls++; return this.playResult(); }
  addEventListener(type, callback) { this.listeners.add(type); super.addEventListener(type, callback); }
  removeEventListener(type, callback) { this.listeners.delete(type); super.removeEventListener(type, callback); }
  makeReady() { this.readyState = 2; this.videoWidth = 640; this.videoHeight = 480; this.paused = false; }
}

function inputEvent(type, properties = {}) {
  return Object.assign(new Event(type, { cancelable: true }), properties);
}
function pointerEvent(type, pointerType = 'mouse', pointerId = 1, properties = {}) {
  return inputEvent(type, { pointerType, pointerId, isPrimary: true, button: 0, ...properties });
}

test('mouse press starts capture synchronously and its click does not start it again', () => {
  const button = new EventTarget();
  const calls = [];
  bindCameraActivation(button, event => calls.push(event));
  const down = pointerEvent('pointerdown');
  button.dispatchEvent(down);
  assert.deepEqual(calls, [down], 'the request must begin inside pointerdown');
  button.dispatchEvent(pointerEvent('pointerup'));
  button.dispatchEvent(inputEvent('click', { detail: 1 }));
  assert.deepEqual(calls, [down], 'legacy MouseEvent click must also be deduplicated');
});

test('touch and pen start on primary release and ignore secondary or cancelled pointers', () => {
  for (const type of ['touch', 'pen']) {
    const button = new EventTarget();
    const calls = [];
    bindCameraActivation(button, event => calls.push(event));
    button.dispatchEvent(pointerEvent('pointerdown', type, 1));
    assert.equal(calls.length, 0);
    button.dispatchEvent(pointerEvent('pointerdown', type, 2, { isPrimary: false }));
    button.dispatchEvent(pointerEvent('pointerup', type, 2, { isPrimary: false }));
    assert.equal(calls.length, 0);
    const up = pointerEvent('pointerup', type, 1);
    button.dispatchEvent(up);
    button.dispatchEvent(pointerEvent('click', type, 1, { detail: 1 }));
    assert.deepEqual(calls, [up]);
    button.dispatchEvent(pointerEvent('pointerdown', type, 3));
    button.dispatchEvent(pointerEvent('pointercancel', type, 3));
    button.dispatchEvent(pointerEvent('pointerup', type, 3));
    assert.deepEqual(calls, [up]);
  }
});

test('an immediate native denial does not make the companion click retry, but the next gesture can', async () => {
  const button = new EventTarget();
  let requests = 0;
  let starting = false;
  bindCameraActivation(button, async () => {
    if (starting) return;
    starting = true;
    const request = requestCamera(() => {
      requests++;
      return Promise.reject(Object.assign(new Error('native rejection'), { name: 'NotAllowedError' }));
    }, { audio: false, video: true });
    try { await request.promise; } catch { /* Caller presents the native failure. */ }
    finally { starting = false; }
  });
  button.dispatchEvent(pointerEvent('pointerdown'));
  assert.equal(requests, 1);
  await flush();
  assert.equal(starting, false, 'request has settled before pointerup and click');
  button.dispatchEvent(pointerEvent('pointerup'));
  button.dispatchEvent(pointerEvent('click', 'mouse', 1, { detail: 1 }));
  assert.equal(requests, 1);
  button.dispatchEvent(pointerEvent('pointerdown'));
  assert.equal(requests, 2, 'a deliberate new gesture retries without a timer');
  await flush();
});

test('keyboard activation prevents native duplication, ignores repeat, and remains usable after a pointer gesture', () => {
  const button = new EventTarget();
  const calls = [];
  bindCameraActivation(button, event => calls.push(event));
  button.dispatchEvent(pointerEvent('pointerdown'));
  for (const code of ['Space', 'Enter']) {
    const key = inputEvent('keydown', { code, repeat: false });
    button.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true);
    assert.equal(calls.at(-1), key);
    const count = calls.length;
    const repeat = inputEvent('keydown', { code, repeat: true });
    button.dispatchEvent(repeat);
    assert.equal(repeat.defaultPrevented, true);
    assert.equal(calls.length, count);
  }
  button.dispatchEvent(inputEvent('keydown', { code: 'Escape' }));
  assert.equal(calls.length, 3);
});

test('click-only browsers and assistive clicks work without stale pointer suppression', () => {
  const button = new EventTarget();
  const calls = [];
  const unbind = bindCameraActivation(button, event => calls.push(event));
  const legacy = inputEvent('click', { detail: 1 });
  button.dispatchEvent(legacy);
  assert.deepEqual(calls, [legacy]);
  button.dispatchEvent(pointerEvent('pointerdown'));
  const assistive = inputEvent('click', { detail: 0 });
  button.dispatchEvent(assistive);
  assert.equal(calls.at(-1), assistive);
  button.dispatchEvent(inputEvent('click', { detail: 0 }));
  assert.equal(calls.length, 4, 'later assistive retry must remain available');
  unbind();
  button.dispatchEvent(pointerEvent('pointerdown'));
  button.dispatchEvent(inputEvent('click', { detail: 1 }));
  assert.equal(calls.length, 4);
});

test('camera request calls getUserMedia in the original tap stack and transfers ownership once', async () => {
  const stream = streamFixture();
  const constraints = { audio: false, video: { facingMode: { ideal: 'environment' } } };
  let insideTap = true, called = false;
  const request = requestCamera(input => {
    assert.equal(insideTap, true, 'permission request must not move behind a microtask or timer');
    assert.equal(input, constraints);
    called = true;
    return Promise.resolve(stream);
  }, constraints, { timeoutMs: 100 });
  assert.equal(called, true);
  insideTap = false;
  assert.equal(await request.promise, stream);
  request.cancel();
  assert.deepEqual(stream.tracks.map(track => track.stops), [0, 0], 'caller owns an accepted stream');
});

test('browser permission rejection and synchronous API errors reach the caller unchanged', async () => {
  const denied = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  const asyncRequest = requestCamera(() => Promise.reject(denied), { video: true }, { timeoutMs: 100 });
  await assert.rejects(asyncRequest.promise, error => error === denied);
  const syncRequest = requestCamera(() => { throw denied; }, { video: true }, { timeoutMs: 100 });
  await assert.rejects(syncRequest.promise, error => error === denied);
});

test('an unanswered permission request times out and disposes every late camera track', async () => {
  const permission = deferred();
  const request = requestCamera(() => permission.promise, { video: true }, { timeoutMs: 15 });
  await assert.rejects(request.promise, { name: 'CameraPermissionTimeout' });
  const lateStream = streamFixture();
  permission.resolve(lateStream);
  await flush();
  assert.deepEqual(lateStream.tracks.map(track => track.stops), [1, 1]);
});

test('navigation cancellation rejects promptly and cannot leak a later permission grant', async () => {
  const permission = deferred();
  const request = requestCamera(() => permission.promise, { video: true }, { timeoutMs: 100 });
  const rejected = assert.rejects(request.promise, { name: 'AbortError' });
  request.cancel();
  request.cancel();
  await rejected;
  const lateStream = streamFixture();
  permission.resolve(lateStream);
  await flush();
  assert.deepEqual(lateStream.tracks.map(track => track.stops), [1, 1]);
});

test('a browser rejection after timeout remains handled', async () => {
  const permission = deferred();
  const request = requestCamera(() => permission.promise, { video: true }, { timeoutMs: 15 });
  await assert.rejects(request.promise, { name: 'CameraPermissionTimeout' });
  permission.reject(Object.assign(new Error('late denial'), { name: 'NotAllowedError' }));
  await flush();
});

test('an already-ready camera starts without waiting for another loadeddata event', async () => {
  const video = new VideoFixture();
  video.makeReady();
  await playCamera(video, { timeoutMs: 100 });
  assert.equal(video.playCalls, 1);
  assert.equal(video.listeners.size, 0);
});

test('camera readiness is detected without loadeddata or any other media event', async () => {
  const video = new VideoFixture();
  const playback = playCamera(video, { timeoutMs: 500 });
  // A mobile browser can update frames without delivering loadeddata.
  await flush();
  video.makeReady();
  await playback;
  assert.equal(video.listeners.size, 0);
});

test('a usable frame event can finish startup even while the play promise remains pending', async () => {
  const video = new VideoFixture();
  video.playResult = () => new Promise(() => {});
  const playback = playCamera(video, { timeoutMs: 100 });
  video.makeReady();
  video.dispatchEvent(new Event('playing'));
  await playback;
  assert.equal(video.listeners.size, 0);
});

test('zero-sized frames and paused playback cannot be mistaken for a ready camera', async () => {
  for (const ready of [
    { readyState: 2, videoWidth: 640, videoHeight: 0, paused: false },
    { readyState: 2, videoWidth: 640, videoHeight: 480, paused: true },
  ]) {
    const video = Object.assign(new VideoFixture(), ready);
    await assert.rejects(playCamera(video, { timeoutMs: 15 }), { name: 'CameraPlaybackTimeout' });
    assert.equal(video.listeners.size, 0);
  }
});

test('stalled playback times out, cleans up listeners, and handles a later play rejection', async () => {
  const video = new VideoFixture();
  const playing = deferred();
  video.playResult = () => playing.promise;
  await assert.rejects(playCamera(video, { timeoutMs: 15 }), { name: 'CameraPlaybackTimeout' });
  assert.equal(video.listeners.size, 0);
  playing.reject(new Error('late playback failure'));
  await flush();
});

test('play rejection, thrown play error, and media error all produce recoverable failure', async () => {
  for (const playResult of [
    () => Promise.reject(new Error('autoplay blocked')),
    () => { throw new Error('play failed'); },
  ]) {
    const video = new VideoFixture();
    video.playResult = playResult;
    await assert.rejects(playCamera(video, { timeoutMs: 100 }), { name: 'CameraPlaybackError' });
    assert.equal(video.listeners.size, 0);
  }
  const video = new VideoFixture();
  video.playResult = () => new Promise(() => {});
  const playback = playCamera(video, { timeoutMs: 100 });
  const rejected = assert.rejects(playback, { name: 'CameraPlaybackError' });
  video.dispatchEvent(new Event('error'));
  await rejected;
  assert.equal(video.listeners.size, 0);
});

test('superseded camera playback stops waiting and removes its event listeners', async () => {
  const video = new VideoFixture();
  let current = true;
  const playback = playCamera(video, { timeoutMs: 500, isCurrent: () => current });
  const rejected = assert.rejects(playback, { name: 'AbortError' });
  await flush();
  current = false;
  await rejected;
  assert.equal(video.listeners.size, 0);
});

test('permission rejection, an unanswered request, and playback failure stay distinguishable', () => {
  const denied = describeCameraFailure({ name: 'NotAllowedError' }, 'request');
  const unanswered = describeCameraFailure({ name: 'CameraPermissionTimeout' }, 'request');
  const playback = describeCameraFailure({ name: 'CameraPlaybackTimeout' }, 'playback');
  assert.match(denied, /rejected camera access before capture/);
  assert.match(unanswered, /has not answered/);
  assert.match(playback, /access succeeded.*playback did not start/);
  assert.notEqual(denied, unanswered);
  assert.notEqual(denied, playback);
  assert.equal(describeCameraFailure({ name: 'SecurityError' }, 'request'), denied);
  assert.match(describeCameraFailure({ name: 'NotAllowedError' }, 'playback'), /blocked camera playback/);
  // The browser's error does not identify whether OS, site, or policy denied it.
  for (const message of [denied, unanswered, playback]) {
    assert.doesNotMatch(message, /settings|turned off|Chrome|iPhone|disabled by/i);
  }
});

test('device, constraint, and unknown failures retain the information needed to diagnose them', () => {
  assert.match(describeCameraFailure({ name: 'NotFoundError' }), /did not find/);
  assert.match(describeCameraFailure({ name: 'NotReadableError' }), /could not start.*device/);
  assert.match(describeCameraFailure({ name: 'OverconstrainedError' }), /requested settings/);
  assert.equal(describeCameraFailure({ name: 'UnexpectedError', message: 'Native diagnostic detail' }), 'Native diagnostic detail');
});

function environmentFixture() {
  const self = {};
  const win = { isSecureContext: true, top: self, self, location: { origin: 'https://taewooopark.github.io' } };
  // A diagnostic must not inspect the image-bearing fragment, page contents,
  // device labels, or camera pixels just to describe its execution context.
  for (const key of ['hash', 'href', 'search']) Object.defineProperty(win.location, key, { get() { throw new Error('Private URL content read'); } });
  const nav = { userActivation: { isActive: true }, mediaDevices: { getUserMedia() {}, enumerateDevices() { throw new Error('Device enumeration is unnecessary'); } }, userAgent: 'iPhone CriOS test' };
  const doc = { visibilityState: 'visible', hasFocus: () => true, permissionsPolicy: { allowsFeature(name) { assert.equal(name, 'camera'); return true; } } };
  Object.defineProperty(doc, 'body', { get() { throw new Error('Page or image content read'); } });
  return { win, nav, doc };
}

test('camera environment records relevant context without reading image data or URL fragments', () => {
  const { win, nav, doc } = environmentFixture();
  assert.deepEqual(cameraEnvironment(win, nav, doc), {
    secureContext: true, topLevel: true, visibility: 'visible', focused: true,
    userActivation: true, cameraPolicy: true, mediaDevices: true,
    userAgent: 'iPhone CriOS test', origin: 'https://taewooopark.github.io',
  });
});

test('environment reports iframe and blocking policy distinctly from unavailable policy inspection', () => {
  const { win, nav, doc } = environmentFixture();
  win.top = {};
  doc.permissionsPolicy.allowsFeature = () => false;
  assert.equal(cameraEnvironment(win, nav, doc).topLevel, false);
  assert.equal(cameraEnvironment(win, nav, doc).cameraPolicy, false);
  delete doc.permissionsPolicy;
  doc.featurePolicy = { allowsFeature: () => true };
  assert.equal(cameraEnvironment(win, nav, doc).cameraPolicy, true);
  doc.featurePolicy.allowsFeature = () => { throw new Error('Unsupported feature'); };
  delete nav.userActivation;
  const unsupported = cameraEnvironment(win, nav, doc);
  assert.equal(unsupported.cameraPolicy, 'unavailable');
  assert.equal(unsupported.userActivation, 'unavailable');
});

test('camera permission inspection preserves browser states and identifies unsupported APIs', async () => {
  for (const state of ['granted', 'prompt', 'denied']) {
    const nav = { permissions: { query: async descriptor => { assert.deepEqual(descriptor, { name: 'camera' }); return { state }; } } };
    assert.equal(await readCameraPermission(nav), state);
  }
  assert.equal(await readCameraPermission({}), 'unsupported');
  assert.equal(await readCameraPermission({ permissions: { query: async () => { throw new TypeError('Camera permission not supported'); } } }), 'unsupported');
  assert.equal(await readCameraPermission({ permissions: { query: () => { throw new TypeError('Unknown permission'); } } }), 'unsupported');
});

test('permission inspection cannot wait indefinitely or mislabel a stalled query as denied', async () => {
  const pending = deferred();
  assert.equal(await readCameraPermission({ permissions: { query: () => pending.promise } }), 'unanswered');
  pending.reject(new Error('late unsupported result'));
  await flush();
});
