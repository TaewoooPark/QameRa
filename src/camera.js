const cameraError = (name, message) => Object.assign(new Error(message), { name });

/** Start within the device's activation event, once per pointer gesture.
 * Touch/pen activation occurs on release; mouse activation occurs on press.
 * A following click must not retry a request that has already failed.
 */
export function bindCameraActivation(button, activate) {
  let gesture = null;
  const primary = event => event.isPrimary !== false && event.button === 0;
  const down = event => {
    if (button.disabled || !primary(event)) return;
    gesture = { id: event.pointerId, type: event.pointerType, started: false };
    if (event.pointerType === 'mouse') {
      gesture.started = true;
      activate(event);
    }
  };
  const up = event => {
    if (!gesture || gesture.id !== event.pointerId || !primary(event)) return;
    if (button.disabled || gesture.started) return;
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      gesture.started = true;
      activate(event);
    }
  };
  const cancel = event => {
    if (gesture?.id === event.pointerId) gesture = null;
  };
  const key = event => {
    if (button.disabled || !['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    gesture = null;
    activate(event);
  };
  const click = event => {
    const pointerClick = event.detail > 0 || Boolean(event.pointerType);
    const samePointer = !Number.isFinite(event.pointerId) || event.pointerId === gesture?.id;
    const alreadyStarted = gesture?.started && pointerClick && samePointer;
    gesture = null;
    if (!button.disabled && !alreadyStarted) activate(event);
  };
  const handlers = { pointerdown: down, pointerup: up, pointercancel: cancel, keydown: key, click };
  for (const [type, handler] of Object.entries(handlers)) button.addEventListener(type, handler);
  return () => {
    gesture = null;
    for (const [type, handler] of Object.entries(handlers)) button.removeEventListener(type, handler);
  };
}

/** Call getUserMedia synchronously in the tap handler, but bound the wait.
 * The browser's permission prompt itself cannot be cancelled. A stream that
 * arrives after timeout/cancellation must be stopped rather than attached.
 */
export function requestCamera(getUserMedia, constraints, { timeoutMs = 15000 } = {}) {
  let settled = false;
  let rejectRequest;
  let timer;
  const promise = new Promise((resolve, reject) => {
    rejectRequest = reject;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(cameraError('CameraPermissionTimeout', 'The camera permission request did not finish.'));
    }, timeoutMs);
    try {
      // Do not defer this call behind a timer, permission query, or await.
      Promise.resolve(getUserMedia(constraints)).then(stream => {
        if (settled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      }, error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRequest(cameraError('AbortError', 'Camera startup cancelled.'));
    },
  };
}

/** loadeddata is not guaranteed on mobile. Inspect readyState and dimensions
 * as well, and never let video.play() or a missing event trap startup forever.
 */
export function playCamera(video, { timeoutMs = 8000, isCurrent = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize'];
    let done = false;
    let poll;
    let timer;
    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      events.forEach(event => video.removeEventListener(event, check));
      video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (!isCurrent()) return finish(cameraError('AbortError', 'Camera startup cancelled.'));
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && !video.paused) finish();
    };
    const failed = () => finish(cameraError('CameraPlaybackError', 'Camera preview could not start.'));
    events.forEach(event => video.addEventListener(event, check));
    video.addEventListener('error', failed);
    poll = setInterval(check, 100);
    timer = setTimeout(() => finish(cameraError('CameraPlaybackTimeout', 'The camera did not provide an image.')), timeoutMs);
    try { Promise.resolve(video.play()).then(check, failed); }
    catch { failed(); }
    check();
  });
}

/** Keep native errors distinct: an unanswered prompt is not a denied prompt. */
export function describeCameraFailure(error, stage = 'request') {
  if (error.name === 'CameraPermissionTimeout') return 'The browser has not answered the camera request.';
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return stage === 'request' ? 'The browser rejected camera access before capture started.' : 'The browser blocked camera playback.';
  }
  if (error.name === 'NotFoundError') return 'The browser did not find an available camera.';
  if (error.name === 'NotReadableError') return 'The browser could not start the camera device.';
  if (error.name === 'OverconstrainedError') return 'The camera could not meet the requested settings.';
  if (stage === 'playback') return 'Camera access succeeded, but video playback did not start.';
  return error.message || 'Camera startup failed.';
}

export function cameraEnvironment(win = window, nav = navigator, doc = document) {
  let cameraPolicy = 'unavailable';
  try {
    const policy = doc.permissionsPolicy || doc.featurePolicy;
    if (policy?.allowsFeature) cameraPolicy = policy.allowsFeature('camera');
  } catch { cameraPolicy = 'unavailable'; }
  return {
    secureContext: win.isSecureContext,
    topLevel: win.top === win.self,
    visibility: doc.visibilityState,
    focused: doc.hasFocus(),
    userActivation: nav.userActivation?.isActive ?? 'unavailable',
    cameraPolicy,
    mediaDevices: Boolean(nav.mediaDevices?.getUserMedia),
    userAgent: nav.userAgent,
    origin: win.location.origin,
  };
}

export async function readCameraPermission(nav = navigator) {
  if (!nav.permissions?.query) return 'unsupported';
  let timer;
  try {
    return await Promise.race([
      nav.permissions.query({name: 'camera'}).then(result => result.state),
      new Promise(resolve => { timer = setTimeout(() => resolve('unanswered'), 1000); }),
    ]);
  } catch { return 'unsupported'; }
  finally { clearTimeout(timer); }
}
