# Design provenance

QameRa's mobile control study was built in Figma using the **iOS and iPadOS 26** community library supplied through Figma's Apple UI kit integration.

[Open the editable iOS design study](https://www.figma.com/design/nZW2CrigD44tDAysUYQY22?node-id=1-135)

[Open the two-second intro study](https://www.figma.com/design/nZW2CrigD44tDAysUYQY22?node-id=3-40)

## Components actually used

| Library asset | Source component key | Use |
| --- | --- | --- |
| Sliders | `03734c616a83f5d181c042a7cbf978fdc3e8d8af` (component set) | Exposure control; imported 50% variant, 52px row and 6px track |
| Button – Liquid Glass – Symbol | `bae56ff9b36723a4780ab9bc01ec7dcac3a67b38` (component set) | Two 48 × 48px circular camera controls |
| Body/Regular | `61d8660a05c78e23eb7acac3bc9a0f327591ebe4` (text style) | SF Pro type reference, 17px size / 22px line height |
| Colors / Dark | `0f8f6921a9a4bfc5bade1f3d7d9f01bf5dd3f77f` (variable collection) | Native component dark appearance |

The composed 393 × 852px camera screen contains editable text, vectors, shapes, and component instances. It contains 42 descendant layers, including 12 instances, and no raster image fills. The QR square is 377 × 377px, leaving 8px outer margins on each side. Text uses SF Pro in the Figma study. The QR in this design study encodes the app's homepage; the deployed app creates image-bearing QR codes dynamically.

A separate 393 × 852px intro frame contains only one centered, editable QameRa wordmark. The intro lasts two seconds in the website, then the brand disappears. The camera screen contains the QR and core controls at the bottom; it has no header, status label, information button, demo button, wordmark, or decorative captions.

The black background (`#090909`), egg yellow accent (`#f6ce64`), and square viewfinder are project-specific choices. The interface keeps functional labels in title case and removes decorative captions. On iPhone, the website uses the native system font through `-apple-system`.

## What ships on the web

The website implements the control geometry in HTML and CSS, uses the device's system font, and uses original inline SVG icons. Apple font binaries, SF Symbol glyph exports, and extracted Apple UI-kit components are not included in the repository or web bundle.

Apple's design assets remain in the iOS design study. The [Apple Design Resources license](https://developer.apple.com/support/downloads/terms/apple-design-resources/Apple-Design-Resources-License-20230621-English.pdf) permits designated Apple-platform interface mockups and places restrictions on embedding or redistributing the underlying resources. The website's own screenshots document the running application.

See also [Figma's Apple UI kit guidance](https://help.figma.com/hc/en-us/articles/24037833895831-Get-started-with-Apple-s-UI-kit).

## 한국어

Figma의 **iOS and iPadOS 26** 라이브러리에서 실제 슬라이더와 Liquid Glass 원형 버튼을 가져와 iOS 디자인 스터디를 만들었습니다. 48px 버튼, 6px 슬라이더 트랙, 시스템 타이포그래피를 웹 인터페이스의 기준으로 삼았습니다. 2초 동안 화면 가운데 QameRa만 표시한 뒤 브랜드 문구가 사라집니다. 카메라 화면의 QR은 393px 너비에서 377px를 차지하며 좌우 여백은 8px입니다. 상단 상태 표시·정보 버튼·데모 버튼·장식 문구를 없애고 하단 조작부의 기능 이름만 자연스러운 대소문자로 표시합니다. 강조색은 달걀 노랑(`#f6ce64`)이며, iPhone에서는 기본 시스템 글꼴을 사용합니다.

배포되는 웹은 HTML/CSS와 자체 SVG 아이콘으로 구현하며, 기기의 시스템 글꼴을 사용합니다. Apple 글꼴 파일이나 SF Symbols 추출본을 공개 저장소에 포함하지 않습니다. README의 실행 이미지는 웹 애플리케이션을 직접 촬영한 화면입니다.
