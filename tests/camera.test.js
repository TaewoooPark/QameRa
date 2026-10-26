import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCamera, playCamera, permissionHelp } from '../src/camera.js';

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

test('iPhone Chrome permission help points to iOS Chrome settings without claiming to override them', () => {
  const help = permissionHelp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/142.0.0.0 Mobile/15E148 Safari/604.1', 5);
  assert.match(help.message, /Chrome/);
  assert.match(help.message, /Settings/);
  assert.equal(new URL(help.url).hostname, 'support.google.com');
  assert.equal(new URL(help.url).searchParams.get('co'), 'GENIE.Platform=iOS');
  assert.equal(new URL(permissionHelp('Mozilla/5.0 (Macintosh) CriOS/142.0', 5).url).searchParams.get('co'), 'GENIE.Platform=iOS');
  assert.notEqual(new URL(permissionHelp('Mozilla/5.0 (Android) Chrome/142.0', 5).url).searchParams.get('co'), 'GENIE.Platform=iOS');
});
