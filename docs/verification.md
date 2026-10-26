# Verification notes

Initial release verification, 26 October 2026. These checks distinguish a readable generated QR from an optical scan using two physical phones.

## Automated codec checks

Six Node tests passed with `npm test`:

- A frame URL carries the complete JPEG and drops development query parameters.
- Empty fragments select camera mode; unsupported or malformed payloads are rejected.
- Oversized, truncated, non-JPEG, and excessive-dimension inputs are rejected.
- An independent jsQR decoder reads the generated QR and recovers the original JPEG bytes; the four-module quiet zone stays white.
- The detailed URL budget fits a standard QR, and oversized QR inputs are rejected.
- A near-budget frame decodes within the actual 374px mobile display width.

The small JPEG fixture is an original generated RGB gradient, not a camera capture.

## Browser checks

A browser functional pass completed **14 assertions** covering live sample QR decoding, exact frozen payload recovery, monochrome decoded pixels, payload budgets, an image viewer that does not request camera access, malformed-link recovery, and layouts at **375 × 667**, **390 × 844**, and **430 × 932** CSS pixels. This pass was rerun successfully after the standard URL budget changed to **1,150 characters (Std)**, with **2,200 characters (Fine)**, and QR modules were drawn at integer pixel sizes.

A QR cropped from the actual **390 × 844px rendered screenshot** was independently decoded with ZXing. Both the README's [mobile screenshot](images/qamera-mobile.png) and the held-frame capture yielded the exact **1,069-character public HTTPS image URL**. The decoded image's monochrome pixels were also checked. This checks what the browser displayed, beyond generating a decodable source canvas; it does not prove optical readability by every phone scanner.

A separate controlled camera-stream pass completed **11 checks**. It covered the two-second introduction, no camera request during that introduction, removal of branding afterward, the front/rear camera request, exposure changes, frame freezing, and retry after permission denial. The stream was supplied by the test harness; it was not an actual phone camera. This pass preceded the final header removal and QR pixel-rendering adjustments; those later visual changes were covered by the browser and screenshot checks above.

## Scan URL routing

A loopback URL such as `127.0.0.1` points to the scanning phone itself, so it cannot be used to reach the development computer. Localhost development now encodes the public HTTPS viewer URL by default. `VITE_FRAME_BASE_URL` can select another deployment. This routing change does not upload the image: its bytes remain in the URL fragment.

## Image provenance and remaining limits

README images are browser captures using the application's original generated plant scene. There is no Demo label or sample button in the public camera interface; the fixture is selected through a development query parameter.

Actual camera capture on a physical phone, optical scanning from a second phone, and hardware focus/torch behavior have **not** been verified. Browser viewport emulation and an injected camera stream do not substitute for those checks. Dense Fine codes are especially dependent on the screen, distance, movement, and scanner app.

## 한국어

Node 코덱 테스트 **6개**, 브라우저 기능 검증 **14개**, 테스트용 카메라 스트림을 통한 검증 **11개**를 통과했다. 브라우저 기능 검증은 기본 URL 한도를 1,150자로 줄이고 QR 모듈을 정수 픽셀로 그리도록 수정한 뒤 다시 통과했다. 실제 390 × 844px 화면 캡처에 나타난 QR을 ZXing으로 읽어 **1,069자의 공개 HTTPS 이미지 URL**이 정확히 복원되는 것도 확인했다. 테스트용 카메라 스트림 검증은 마지막 헤더 제거와 QR 렌더링 수정 전에 수행했으며, 이후 화면 변경은 브라우저·캡처 검증으로 확인했다.

README 이미지는 앱에서 생성한 식물 장면으로 실행 화면을 캡처한 것이다. 실제 휴대폰 카메라 촬영, 두 대의 휴대폰을 이용한 광학 스캔, 하드웨어 초점·조명 동작까지 검증한 것은 아니다.


## iPhone Chrome startup correction

The follow-up change removes intro-timer permission requests. `getUserMedia` is invoked directly from the Open camera tap, with a 15-second request deadline and cleanup of streams arriving after timeout or navigation. Video startup uses bounded readiness checks rather than waiting indefinitely for `loadeddata`. Reveal navigates in the same tab.

Thirteen additional Node regression tests cover synchronous permission requests, timeout/cancellation, late stream disposal, frame readiness without `loadeddata`, playback errors, and listener cleanup; all 19 Node tests pass.

A Chromium browser run with an iPhone Chrome user-agent and controlled camera stream passed 12 regression checks: no request before tapping, active user gesture at the request, pending-request timeout, retry availability, iPhone-specific help, late-stream cleanup, successful second attempt, image navigation without a popup, return navigation, and immediate denial recovery. This is simulation of the failure paths, **not a test on a physical iPhone or the iOS WebKit engine**.

Google documents that disabling Chrome's camera permission at the iPhone level can suppress the site prompt entirely. The site cannot override that setting. [Chrome iPhone camera permissions](https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DiOS&hl=en)


## Immediate iPhone Chrome rejection investigation

The user reported that the previous correction still failed and the help link appeared almost immediately. That link could only appear for native `NotAllowedError`/`SecurityError` or the 15-second timeout. Immediate appearance therefore points to the permission-request branch, not QR rendering or video playback. The previous common settings message hid that distinction and has been removed.

The published HTML and JavaScript match the local build. The page is served over HTTPS and has no camera-denying Permissions Policy, embedding iframe, sandbox, or service worker. Requested size and camera direction are optional `ideal` constraints. These observations do not identify which native permission layer rejects the user's request.

Current WebKit code rejects denied/restricted OS camera authorization without prompting. Chrome's native permission UI can also refuse a request. This is evidence of possible mechanisms, not proof of this particular phone's state. [WebKit authorization handling](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Cocoa/UserMediaPermissionRequestManagerProxy.mm), [Chrome iOS permission UI](https://chromium.googlesource.com/chromium/src/+/main/ios/web/web_state/ui/crw_permission_request.mm)

`camera-check.html` isolates native capture with `{audio:false,video:true}`, keeps raw errors and request/playback stages, and shows the granted stream in a visible video element. Its report contains browser/context/permission information but no image data, device identifiers, or URL fragments. Nothing is transmitted by the probe. A result from the affected physical iPhone is still needed; this release is instrumentation and link removal, not a claim that the phone's camera problem has been fixed.

## Noisample comparison

The user confirmed that noisample requests microphone permission successfully on the same iPhone Chrome. Source inspected at `39c6b92a6788a4d54f77b58a4bc09fdb81b93a97`: `dist/app.js` handles `pointerdown`, then calls `BeatEngine.start()` synchronously; `_initialize()` calls `getUserMedia` before its first suspension. QameRa's previous `click` handler also reached `getUserMedia` synchronously. A Promise executor does not itself defer the call. The comparison therefore does not prove that QameRa lost user activation.

QameRa now uses the same immediate, guarded capture-start structure, with mouse press, touch/pen release, keyboard activation, and a click fallback. The companion click is suppressed even after an immediate denial, so one gesture cannot open two requests. Touch uses release because WebKit identifies `pointerup`/`touchend` as activation events for touch input. Preferred size is applied only after playback succeeds. Native request diagnostics include event type, pointer type, trusted-event state, and transient activation. The standalone probe still supplies a separate `{audio:false,video:true}` comparison.

Noisample's AudioContext setup is for audio playback; it was not copied into this camera application. WebKit checks camera and microphone permission independently, so working microphone capture does not establish the camera authorization state. This change is awaiting confirmation on the affected physical iPhone. [Noisample entry point](https://github.com/TaewoooPark/noisample/blob/39c6b92a6788a4d54f77b58a4bc09fdb81b93a97/dist/app.js), [Noisample capture](https://github.com/TaewoooPark/noisample/blob/39c6b92a6788a4d54f77b58a4bc09fdb81b93a97/dist/engine.js), [WebKit user activation](https://webkit.org/blog/13862/the-user-activation-api/), [WebKit camera and microphone checks](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/mediastream/MediaDevices.cpp)

Validation: all 29 Node tests pass. A focused Chromium run with touch and mouse input passed 16 checks, including trusted transient activation at the native call, one request per gesture after an immediate rejection, keyboard retry, optional sizing failure recovery, QR capture, and image reveal. The diagnostic page separately passed 11 browser checks for exact native error preservation, minimal constraints, gesture timing, retry, stream playback, and stop. These use controlled camera streams and errors, not physical iPhone hardware. The production build and whitespace checks pass.
