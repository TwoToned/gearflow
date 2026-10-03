# In-app barcode scanner: 2D, QR, Micro QR and rMQR

**Status:** implemented
**Supersedes:** the removed `html5-qrcode`-based `BarcodeScanner` / `ScanInput`
**Code:** `src/lib/barcode/*`, `src/hooks/use-camera-scanner.ts`, `src/components/scanner/*`
**Feature doc:** [FEATUREDOCS/19](../../FEATUREDOCS/19-mobile-pwa.md)

## 1. Why there was no scanner

The first in-app camera scanner was built on `html5-qrcode` and removed because
it "never worked reliably on iPhone". That diagnosis was accurate but not
specific, and the lack of specificity is why nothing was fixed — the library was
blamed for what were really four independent platform facts, each of which
would have broken any library:

1. **iOS has no `BarcodeDetector`.** `html5-qrcode` prefers the native Barcode
   Detection API and falls back to a JS decoder. WebKit has never implemented
   that API, and every browser on iOS is WKWebView, so the fallback is the only
   path there — a different decoder, with different behaviour, than the one
   every Android tester saw.
2. **The app ships `display: standalone`.** Installed to the Home Screen, iOS
   does not persist the camera permission across launches (WebKit
   [215884](https://bugs.webkit.org/show_bug.cgi?id=215884)), and historically
   did not grant it at all (WebKit
   [185448](https://bugs.webkit.org/show_bug.cgi?id=185448), fixed in iOS 13.4).
   A re-prompt that the user misses reads as "the scanner is broken".
3. **iOS needs `playsInline` + `muted` + an explicit awaited `play()`.** Without
   all three, `getUserMedia` succeeds, the track is live, and the `<video>`
   paints black — the "camera permission granted, black screen" reports that
   fill that library's issue tracker.
4. **A denied or failed start had no UI.** The failure surface was a black
   rectangle, so every distinct cause looked identical to every other.

None of this was covered by a test, because there was no test anywhere that put
a barcode in and asserted a value out.

## 2. Requirement

Read 2D codes generally, and specifically **QR, Micro QR and rMQR** — the small
formats that fit on cable labels and small-instrument plates, where a full QR
does not.

## 3. The decisive constraint

`micro_qr_code` and `rm_qr_code` **are not in the Shape Detection API spec.**
Its format enum stops at `qr_code`. Chrome on Android implements the API over
Google Play Services / ML Kit, which does not decode either format.

So the platform API cannot satisfy the requirement on **either** platform:

| | `BarcodeDetector` available? | Decodes Micro QR / rMQR? |
|---|---|---|
| Chrome / Android | yes (Play Services) | **no** |
| Any browser on iOS | **no** (WebKit never shipped it) | n/a |
| Firefox (any) | no | n/a |

This collapses what looked like a trade-off. "Native where available, WASM
fallback" would ship two decoders with different format coverage, different
rotation and inversion behaviour, and different failure modes, behind one
button — which is precisely how the first scanner came to behave differently on
the platform nobody tested. **One engine on both platforms** is the only
configuration where "it works on Android" is evidence about iOS.

## 4. Engine: ZXing-C++ via WebAssembly

[`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) — ZXing-C++ compiled to
WASM. Reads Micro QR (zxing-cpp 2.0+) and rMQR (2.2+), plus Data Matrix, Aztec,
PDF417 and the linear symbologies.

Used **directly**, not through the `barcode-detector` ponyfill that wraps it.
The ponyfill's value is presenting the platform API's shape, and we have
established that shape can't express what we need; going direct also exposes
`ReaderOptions` (`tryHarder` / `tryRotate` / `tryInvert` / `maxNumberOfSymbols`),
which is most of the reliability tuning in §6.

**The binary is self-hosted.** `zxing-wasm` fetches ~930 KiB from jsDelivr at
first decode by default. For a warehouse app that is a scanner which opens the
camera and then silently never decodes — on flaky wifi, behind an egress proxy,
or under any future CSP. `scripts/sync-zxing-wasm.mjs` copies it to
`public/wasm/`; the copy is committed (so `pnpm dev` needs no build step) and
`pnpm run wasm:sync:check` gates it in CI, because a `zxing-wasm` bump that
skipped the sync would pair new JS glue with an old binary and fail only in the
browser at instantiate time.

## 5. The iOS brief

Every browser on iOS is WKWebView, so "works in Chrome on iPhone" and "works in
Safari on iPhone" are one question. What that costs, and what we do about it:

| Constraint | Consequence | Our response |
|---|---|---|
| No `BarcodeDetector` | Platform API unusable | WASM engine everywhere (§4) |
| No torch, no zoom, no `focusDistance` — `getCapabilities()` returns neither key, and `applyConstraints({advanced:[{torch:true}]})` is a silent no-op | A torch button would do nothing | Feature-detect; the control is **absent** on iOS, not dead |
| No lens selection — `MediaDevices` has no concept of an ultra-wide vs wide lens, so the web cannot use `AVCaptureDevice.minimumFocusDistance` the way a native app does | `facingMode: "environment"` gives the wide camera, min focus ≈ 10 cm; leaning in to read a small code makes it blur | Resolution instead of optics: request 1080p, decode a native-resolution centre crop (§6), and frame the UI so operators back off rather than lean in |
| One live capture at a time — a second `getUserMedia` steals the track and leaves the first `<video>` black | A leaked track blocks the next `getUserMedia` **app-wide** | `stopStream` on every teardown path: close, unmount, visibility change, and each early return inside `start()` |
| Permission not persisted for installed PWAs (WebKit 215884) | The prompt reappears; a denial is an ordinary state | `classifyCameraError` gives denial real recovery copy and a Try again button |
| `playsInline` + `muted` + awaited `play()` required | Otherwise: live track, black picture | Set in JSX **and** imperatively on each start (the element is reused across opens, and React does not re-apply a first-mount property) |
| iOS suspends capture when backgrounded and does not resume | Returning to the app shows a permanently black viewport | Release on `visibilitychange` → hidden; re-acquire on next open |

Android is the easier platform but not a free pass: `rVFC` arrived in Chrome
relatively recently, torch is advertised and then sometimes refused, and
`getImageData` on a GPU-promoted canvas stalls without `willReadFrequently`.

## 6. Reliability decisions

- **Decode a native-resolution centre crop, not the whole frame.** Counter-
  intuitively this is both faster (a quarter of the pixels) *and* reads smaller
  codes, because the alternative is downscaling 1080p to something the decoder
  will chew — which is exactly what destroys an 11×11-module Micro QR. The crop
  is derived from `ROI_FRACTION`, the same constant the on-screen reticle is
  sized from, so the box cannot lie about the scan area.
- **Curated format list, not `"All"`.** ZXing runs a locator per enabled
  symbology family per frame. Every DataBar/Telepen variant we never print costs
  frame rate and widens the misread surface — a silent wrong-asset scan is worse
  than a no-read.
- **8 decodes/second.** Past human aim speed, well inside a phone's thermal
  budget. Frames are pumped by `requestVideoFrameCallback` (Safari 15.4+, Chrome
  Android) so we never decode the same frame twice; `requestAnimationFrame`
  would both over-fire against a 30 fps camera and stop when the tab hides.
- **`tryHarder` / `tryRotate` / `tryInvert` all on.** A dropped frame costs
  nothing (the next is 125 ms away); a missed code costs a re-aim. Operators
  scan sideways constantly, and white-on-black flight-case labels are common.
- **Decodes outside the tag grammar are dropped silently.** Pointing a camera
  at a warehouse incidentally reads shipping labels and product EANs; beeping at
  each one is noise. The grammar matches the server's `SAFE_TAG` exactly, pinned
  by a test, so the scanner never accepts what the server would reject.
- **Duplicate suppression, 1.5 s.** One label sits in front of the lens for many
  frames.

## 7. Testing

`src/lib/barcode/decoder.test.ts` is the test class the first scanner never
had: encode a real symbol with ZXing's writer, render it to `ImageData` the way
the camera pump does, decode it back through the shipping code path. Micro QR
and rMQR are **proven** to decode and to be reported as themselves, not assumed
to be. It reads the *committed* binary, so together with the `wasm:sync:check`
gate, "the wasm we ship actually decodes" is a tested property.

`camera.test.ts` covers the constraint and error decisions as values —
`facingMode` ideal-not-exact, no `deviceId`, torch hidden when absent, teardown
that cannot throw, ROI within bounds. `camera-scanner-dialog.smoke.test.tsx`
covers the states and, critically, that the camera is released on close and on
unmount.

### Device verification (not covered by tests)

Tests cannot answer the optics. Before trusting this in a warehouse, on a real
iPhone **and** a real Android, in Safari/Chrome **and** as an installed PWA:

1. A standard QR asset tag at arm's length.
2. A **Micro QR** at the closest distance that still focuses — this is the
   format most at risk from the wide-lens minimum focus distance (§5).
3. An **rMQR** on a cable label.
4. Deny the permission, then recover through the Try again button.
5. Background the app mid-scan and return — the viewport must recover, not go
   permanently black.
6. Confirm the camera indicator goes out when the dialog closes.

## 8. Known limits

- **No torch or zoom on iOS.** Not a bug we can fix; WebKit exposes neither.
  Dark-shelf scanning on iPhone needs the operator's own torch.
- **No close-focus lens selection on any browser.** A very small code may need a
  native app to read at macro distance.
- **A URL-shaped decode passes the tag grammar.** `:` `/` and `.` are legal tag
  characters, so a query-less URL reaches the server, which answers "no such
  tag". Tightening this has to happen server-side first — it is the authority —
  and risks rejecting tags orgs legitimately use.
- **Decoding runs on the main thread.** At a cropped ROI and 8 fps this is
  comfortably within budget, and it is far easier to debug. If a low-end device
  shows jank, moving `decodeImageData` into a worker is a contained change: it
  is already the single decode entry point.

## 9. Follow-up: the printed labels don't carry real barcodes

Out of scope here, and worth its own change: `src/components/test-tag/label-template.tsx`
draws a **decorative** SVG — 20 bars whose widths come from
`testTagId.charCodeAt(i) % 3` — not an encoded symbology. Nothing can scan it.
A scanner is only half the loop; the labels it is pointed at have to encode
something. `zxing-wasm`'s writer can generate Micro QR and rMQR, so the same
dependency covers it.
