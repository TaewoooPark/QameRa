# Third-party notices

- [node-qrcode](https://github.com/soldair/node-qrcode), MIT License — QR encoding.
- [Vite](https://github.com/vitejs/vite), MIT License — local development and static build.
- [jsQR](https://github.com/cozmo/jsQR), Apache-2.0 — independent QR decoding in verification only.
- [ZXing for JS (`@zxing/library`)](https://github.com/zxing-js/library), Apache-2.0 — independent decoding of rendered QR screenshots in development verification only.
- [pngjs](https://github.com/pngjs/pngjs), MIT License — verification image handling only.

Transitive dependencies retain their respective licenses; exact dependency versions are recorded in package-lock.json.

[Playwright](https://github.com/microsoft/playwright) (Apache-2.0) was used as an external CLI for browser verification. It is not a project dependency or part of the shipped application.

The editable Figma study uses Apple iOS 26 UI Kit components under the Apple Design Resources license. See [design provenance](docs/design-provenance.md) for sources and boundaries. No exported Apple component, SF Symbols artwork, or Apple font file is shipped in this repository. Interface icons are original geometric SVGs; the browser uses the device's installed system font.

The sample plant is drawn with original Canvas geometry in src/main.js. README screenshots show that generated sample in the running application. The diagram in docs/concept.svg is original artwork. This project is not affiliated with Apple.
