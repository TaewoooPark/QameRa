# QameRa

**English** | [한국어](README.ko.md)

**The camera has seen everything. You have seen nothing yet.**

A camera that shows you a QR code instead of a photograph. Point it at something. The square in the middle keeps rewriting itself. To see what it saw, ask another camera.

[Open QameRa on your phone](https://taewooopark.github.io/QameRa/) · [How it works](#light--image--code--image) · [Run locally](#run-locally)

![QameRa: a mobile camera interface whose square viewfinder contains a QR code.](docs/images/qamera-hero.png)

## An image, temporarily illegible

QameRa keeps the familiar gestures of a camera: change the exposure, choose a filter, move closer, freeze a moment. It replaces the picture with the instructions needed to recover it.

The QR is the photograph in another alphabet. A second phone reads it, opens a link, and reconstructs the small image carried inside that link. The first camera sees; the second camera translates.

> Please keep your memories machine-readable.

## Use it

1. Open **[QameRa](https://taewooopark.github.io/QameRa/)** in a mobile browser. After the two-second introduction, tap **Open camera**, then allow camera access.
2. Point the camera. The **1:1 viewfinder shows a live QR**, with no ordinary image preview.
3. Adjust the controls. Those changes become part of the encoded image.
4. Tap the shutter to **freeze the QR**. Aim a second phone's camera at it and open the recognized link.
5. The link displays the image from that moment. Resume the first camera to make another.

The QR can change while you scan it. Freezing it gives the other camera time to read the whole pattern. A scan opens **one captured frame**, not a remote live stream.

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/images/qamera-mobile.png" width="260" alt="QameRa mobile interface showing the QR viewfinder and camera controls."/><br/><strong>What this camera shows</strong><br/>An image written as a code.</td>
    <td width="50%" align="center"><img src="docs/images/qamera-decoded.png" width="260" alt="The image reconstructed from a QameRa QR link."/><br/><strong>What another camera reads</strong><br/>The same moment, visible again.</td>
  </tr>
</table>

These are captures of the running application using a generated demo scene. They illustrate the interface and reconstruction, not a photographed subject or a completed physical two-phone scan.

## Controls

| Control | What it changes |
| --- | --- |
| Shutter | Tap to freeze the current QR; tap again to return to live capture. |
| Camera switch icon | Switch between the front and rear camera when available. |
| Exposure | Brighten or darken the encoded image, from −2 to +2 EV. |
| Focus | Adjust manual hardware focus where supported, or return to Auto. |
| Filter | Choose Original, Mono, Amber, or Ghost. |
| 1× / 1.5× / 2× | Digitally crop into the camera image. |
| Torch icon | Toggle the camera light where the device and browser support it. |
| 1 fps / 2 fps / 0.5 fps | Cycle the QR refresh rate. |
| Std / Fine | Choose a 1,150- or 2,200-character URL budget. Fine allows more image detail and creates denser codes. |
| Save icon | Download the current QR as an image. |
| Eye icon | Freeze and reveal the current image on the same phone. |
| Save image / share icon | On the decoded image page, save the JPEG or share its link. |

Hardware capabilities vary. In particular, a mobile browser may provide camera access without providing manual focus or torch control. QameRa reports unavailable controls instead of pretending to change the lens.

## Light → image → code → image

![Light enters a camera, a low-resolution image becomes a QR code, and a second camera reconstructs the image from its link.](docs/concept.svg)

The browser captures a square camera frame, applies the selected adjustments, and compresses it into a small JPEG. Its bytes become a URL-safe string in the link's **fragment** — the part after `#`. That complete URL is encoded as a normal QR code. The receiving page decodes the fragment and displays the JPEG.

There is **no image upload endpoint, photo database, or per-frame server request**. GitHub Pages serves the application. The picture travels with the QR and the link.

More image detail means a longer link and a denser QR. QameRa reduces image dimensions and JPEG quality to keep the payload bounded. The result is deliberately small and imperfect: enough to recognize the moment, with some of it lost in translation.

### Practical limits

- Live QR updates are much slower than video. Tap the shutter to freeze the code for the most reliable scan.
- Dense codes need a steady camera, a clear screen, and enough distance to fit the whole square. Some camera apps handle long QR links better than others.
- The reconstruction is a low-resolution still image. It does not recover the camera's original resolution.
- Camera access requires HTTPS, or localhost during development. In-app browsers may restrict access; try Safari or Chrome directly.
- Browser verification and QR decoding tests do not establish compatibility with every physical phone. A physical two-phone scan has not yet been verified for this initial release. See the [verification notes](docs/verification.md).

### iPhone Chrome: no permission prompt

Tap **Open camera** after the introduction. Camera access starts directly from that tap; the app no longer starts a permission request from the intro timer. An unanswered request returns to an actionable button after 15 seconds, and camera playback has a separate bounded wait. The eye button opens the image in the same tab, so it does not depend on popup permission.

Capture startup follows [noisample’s immediate media-request pattern](https://github.com/TaewoooPark/noisample/blob/39c6b92a6788a4d54f77b58a4bc09fdb81b93a97/dist/engine.js): call the native API in the input handler before any asynchronous work, then configure the granted stream. Touch starts on release, mouse on press, and keyboard activation is supported. One gesture produces one request. Preferred resolution is applied only after video starts; the initial request only prefers the selected camera direction. Microphone access is never requested.

If Chrome’s camera access is disabled at the iPhone level, the site may receive no permission prompt. Allow Camera for Chrome in iPhone **Settings → Apps → Chrome**, check this site’s camera permission in Chrome, and return to tap **Open camera** again. A webpage cannot turn that permission on or force a Settings redirect. The app now shows the actual error and failing stage instead of assuming a settings cause. The independent [camera check](https://taewooopark.github.io/QameRa/camera-check.html) requests only camera access and displays a local, copyable result. It does not upload video, pictures, or the diagnostic report. [Google’s iPhone Chrome instructions](https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DiOS&hl=en)

### Where the picture goes

The app processes camera frames in your browser. A URL fragment is not included in the HTTP request for the page. Anyone who has the complete QR or link can nevertheless recover the picture; the link may also remain in browser history or be copied by a sharing app. QameRa does not encrypt the image.

## Run locally

Requires **Node.js 22.12 or later** and npm.

```sh
git clone https://github.com/TaewoooPark/QameRa.git
cd QameRa
npm ci
npm run dev
```

Use the local URL printed by Vite. To test on a phone, use an HTTPS development URL or the deployed site; a plain HTTP LAN address generally cannot request camera access.

When the app runs on `localhost` or `127.0.0.1`, its image-bearing QR links point to the public QameRa viewer so another phone can open them. For your own deployment, set `VITE_FRAME_BASE_URL` to its full HTTPS application URL before starting Vite or building. On a deployed host, the current application URL is used by default.

```sh
npm test
npm run build
```

The production build is a static site. GitHub Actions publishes it to GitHub Pages when changes reach `main`.

## Design and credits

The [editable Figma study](https://www.figma.com/design/nZW2CrigD44tDAysUYQY22?node-id=1-135) uses real **iOS and iPadOS 26** slider and Liquid Glass button components. The website implements that study with original SVG icons, HTML/CSS, and the device's system font. The centered wordmark appears for two seconds, then disappears. Black, egg yellow (`#f6ce64`), and quiet title-case controls frame a QR with 8px side margins. Apple glyphs and font files are not redistributed. See [design provenance](docs/design-provenance.md) for the source components and licensing boundaries.

QameRa shares a question with [Sound Code Cube](https://github.com/TaewoooPark/Sound-Code-Cube): what happens when the same thing moves between perceptual forms? There, sound becomes code and space. Here, light becomes an image, the image becomes a code, and another lens returns it to sight.

Original code and documentation are released under the [MIT License](LICENSE). Third-party libraries and design assets retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
