const cameraError = (name, message) => Object.assign(new Error(message), { name });

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

export function permissionHelp(userAgent = '', touchPoints = 0) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (ios && /CriOS/.test(userAgent)) {
    return {
      message: 'No prompt? In iPhone Settings, allow Chrome to use Camera. Also check this site’s camera permission in Chrome, then try again.',
      url: 'https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DiOS&hl=en',
    };
  }
  if (ios) return { message: 'Allow camera access in your browser’s iPhone settings and this site’s permissions, then try again.', url: 'https://support.apple.com/guide/iphone/control-access-to-information-in-apps-iph251e92810/ios' };
  return {
    message: 'Allow Camera for your browser in device settings and for this site, then try again.',
    url: 'https://support.google.com/chrome/answer/2693767',
  };
}
