# Performance and Mobile Review

Review date: 2026-09-24. Branch `perf/mobile-viewer`.

This is the viewer Marengo PACS opens for CT and MR studies. The review looked for three things: why the viewer lags, how it behaves on phones, and what to fix first. Every number below was measured. None are estimates.

## How it was measured
- **Study.** A synthetic chest CT: 300 slices at 512×512, 16-bit HU. One copy is uncompressed (152 MB) and one is JPEG-LS lossless (54 MB).
- **Server.** A local stand-in for the viewer service (`test-data/mock-server.ts`, git-ignored) runs the real `createApp` routes. Sessions are in memory and files replace S3. This exercises the same remote-session path as production.
- **Browser.** Headless Chrome on the machine's Intel Iris Xe GPU (ANGLE/Vulkan).
- **Profiles.**
  - Desktop: 1440×900.
  - Phone: 390×844 at 3× density, touch, with the CPU slowed 4×. This roughly matches a mid-range Android phone.
  - Networks: 20 Mbps and 5 Mbps, both with 70 ms latency.
- **Input.** Real input events sent through the Chrome DevTools Protocol: wheel, mouse drag and keys. The page recorded long tasks (over 50 ms), frame gaps, blank frames and JS heap size.

## What was wrong

| # | Problem | Effect |
|---|---|---|
| 1 | JPEG-LS and JPEG 2000 decoding and rescaling ran on the main thread. The worker only parsed tags. | On the phone profile, every slice change blocked input for 70–145 ms. Opening a study froze the page for up to 2.4 s. |
| 2 | The scheduler loaded neighbouring slices **one at a time** and waited for each one. | On slow networks, each slice paid a full round trip before the next one started. |
| 3 | Every slice change cleared the image and showed a full-screen "Preparing…" layer. That layer also caught wheel and touch events. | On mobile networks the screen was black 54–87% of the time while scrolling. Scroll input stopped until each slice arrived (30 wheel ticks reached slice 8 at 5 Mbps). |
| 4 | The wheel handler used the slice index from the last render. | Fast wheel ticks that arrived before React re-rendered were dropped. |
| 5 | App, the shell, the toolbar and every viewport subscribed to the **whole** viewer store. The renderer also wrote the render time to the store on every frame. | Each slice change, every window/level drag step and every drawn frame re-rendered the whole interface, and the keyboard handlers re-attached each time. |
| 6 | Each cached frame stored both the raw pixels and the Float32 pixels. Nothing reads the raw copy. The cache cap was 512 MB on every device. | 1.5 MB per 512×512 slice. Phones risk the browser killing the tab. |
| 7 | **Parser bug:** SeriesNumber and InstanceNumber are text (IS) but were read as binary numbers first. | "1" displayed as **8241**, and "20" sorted before "11". Series without position tags sorted out of order, and the stack direction could flip. This also affects manifests the import worker built. |
| 8 | MPR: the volume was Float32 (300 MB for this CT) and was stored alongside the frame cache. The 3D texture was built with a slow per-voxel function. Phones used the HD quality. Moving one plane redrew all three planes twice. | Opening MPR used 842 MB and took 18 s on the phone profile, with one 5.9 s freeze. |
| 9 | Phone layout: the header took 3 rows, the series strip 132 px, the "Connected" chip covered the slice slider, and the status bar ran off screen. In landscape, the preset menu covered the "A" marker and the slider covered the corner text. | The image got about 55% of a portrait phone screen. |

## What changed

| Area | Change | Files |
|---|---|---|
| Decoding | Worker pool: 2 workers on phones, up to 4 on desktop. Workers parse, decode, rescale and transfer Float32 pixels back. JPEG-LS and J2K load inside the worker. | `viewer/workers/DecodePool.ts`, `dicomWorker.ts`, `RemoteImageSource.ts`, `LocalFileImageSource.ts`, `vite.config.ts` (`worker.format: 'es'`) |
| Loading | The current slice loads first, then neighbours load in parallel (6 remote). Window: ±10 slices on phones, ±20 on desktop. The download queue serves the newest request first. | `cache/FrameLoadScheduler.ts`, `RemoteImageSource.ts` |
| Viewport | The previous slice stays visible while the next one loads, with a small spinner and the overlay showing the slice actually on screen. The "Preparing" layer no longer catches input. Wheel and cine read the latest index. Resize is observed once. The overlay no longer queries the DOM. | `ViewportCanvas.tsx`, `styles.css` |
| Re-renders | Components subscribe only to the store fields they use. Shortcuts and toolbar actions read the state when used. The status bar samples cache metrics twice a second. Render time is published at most every 0.5 s. | `App.tsx`, `ViewerShell.tsx`, `Toolbar.tsx`, `StatusBar.tsx`, `ViewportGrid.tsx` |
| Memory | Frames keep only the Float32 pixels. Cache: 192 MB on phones or devices with ≤4 GB memory, 512 MB elsewhere. The previous study's workers are released when a new one opens. | `DeviceProfile.ts`, `FrameCache.ts`, `studyStore.ts` |
| Parser | IS tags are read as text. Regression test added. | `DicomParser.ts`, `server/__tests__/importer.test.ts` |
| MPR | The volume is Int16 when values allow (half the memory). The texture build loop is inlined. Phones default to Fast quality. Only a plane that changed is redrawn. | `mpr/Volume.ts`, `MprViewer.tsx` |
| Phone layout | Compact header. A single-series study starts with the series strip folded. The chip auto-hides and sits above the slider. Optional status items are hidden. Landscape offsets are fixed. | `styles.css`, `ViewerShell.tsx`, `RemoteSession.tsx` |
| Renderer | Uniform locations are looked up once. | `WebGLRenderer.ts` |

## Results (before → after)

Phone profile, JPEG-LS CT:

| Measure | Before | After |
|---|---|---|
| Main-thread blocking during a 60-slice fast scroll | 3.8 s (52 janky frames) | **0** |
| Main-thread blocking during a 40-slice steady scroll | 3.0 s (40 janky frames) | **0** |
| Longest freeze while opening the study | 2.4 s | 0.2–1.1 s |
| First image | 3.5 s | 0.9–1.9 s |
| JS heap after scrolling 100 slices | 221–231 MB | 77–117 MB |

Desktop, JPEG-LS CT:

| Measure | Before | After |
|---|---|---|
| Main-thread blocking when opening | 296 ms | 0 |
| JS heap | 222 MB | 127 MB |

Mobile networks (phone profile, 30 wheel ticks at 150 ms):

| | Before | After |
|---|---|---|
| Time the screen was black | 29–87% | **0%** |
| Wheel ticks lost | 9–22 of 30 | **0** |
| 5 Mbps, JPEG-LS: requested slice on screen after scrolling stops | never reached (input lost) | 1.7 s |
| 5 Mbps, raw: requested slice on screen after scrolling stops | never reached (input lost) | 8.8 s (bandwidth-bound; see open items) |

MPR/3D:

| | Before | After |
|---|---|---|
| Desktop: time to open | 4.4 s | 3.0–3.4 s |
| Desktop: JS heap | 842 MB | 542–545 MB |
| Desktop: plane scrolling | 45 fps, 592 ms blocked | 57 fps, 0 ms blocked |
| Phone: JS heap | 842 MB | 359–368 MB |
| Phone: time to open | 18.2 s | 7.5–7.7 s in good runs; see open items |

Phone layout:

| Screen | Image area before | Image area after |
|---|---|---|
| 390×844 portrait | ~55% | **78%** |
| 844×390 landscape | — | 79% |
| 280 px wide | — | 72% |

No sideways scrolling and no overlapping controls at any of these sizes.

Checks: `tsc` passes (app and server), 27/27 tests pass, the production build succeeds, and lint is clean apart from the warning that was already there.

## Open items (not done yet)
1. **MPR 3D texture upload on phones is unverified.** In this test setup, the single `texSubImage3D` call sometimes stalls the GPU driver for 30–115 s; other runs of the same code take 7.7 s. Confirm on a real iPhone and Android phone. If it stalls there too, build the volume texture in a worker and upload it in slabs, or turn off the 3D view by default on phones.
2. **Done (round 2).** ~~Downloads from a fast scroll on a slow network can't be cancelled.~~ Downloads for slices the user has already scrolled past keep using bandwidth. Cancel them with a per-request `AbortController` when they fall outside the prefetch window.
3. **Store compressed copies at import.** The import worker stores studies as they arrive. Raw CT is about 3× larger than JPEG-LS (152 MB vs 54 MB here), which matters most on phones. Transcoding to JPEG-LS lossless at import would cut phone data and load time about 3× with no loss. Manifests imported before the parser fix still carry wrong SeriesNumber and InstanceNumber values until those studies are re-imported.
4. **Done (round 2).** ~~Touch gestures for slices.~~ Phones can only change slices with the slider. A one-finger vertical swipe (with a Scroll tool, or when the active tool is Window/Level) would match what other mobile viewers do.
5. **Done (round 2).** ~~Orientation markers are fixed placeholders.~~ A/P/R/L are always shown the same way. Compute them from ImageOrientationPatient, or hide them until then; the README already lists this.
6. **Done (round 2).** ~~Thumbnail competes with the first slice.~~ The series thumbnail downloads the middle slice at the same time as slice 1. On slow networks, delay it until the first image is on screen.

## Round 2 (2026-09-25): loading strategy from the reference viewer

The RadAgent viewer (`radagent-imaging-stack/custom-viewer`, Cornerstone3D) is fast mostly because of how it loads, not how it renders. Its loading rules were ported here. Several viewer bugs found along the way were also fixed.

### What changed

| Area | Change | Files |
|---|---|---|
| Request queue | Every frame load goes through a priority queue, like Cornerstone's request pools. The slice on screen runs first. Prefetch has its own limit (2 on phones, 4 on desktop) and waits while the slice on screen loads. A load nobody needs is cancelled, including an in-flight download. | `cache/FrameRequestQueue.ts`, `RemoteImageSource.ts`, `LocalFileImageSource.ts` |
| Prefetch | The window leans in the scroll direction (phone 15 ahead / 5 behind, desktop 30 / 10). Local series prefetch only what fits in the cache. Before, a series bigger than the cache decoded end to end and evicted the slices next to the one on screen. | `cache/FrameLoadScheduler.ts` |
| Thumbnails | Thumbnails wait for the first image, load one at a time at the lowest priority, and pause while the user scrolls. | `cache/BackgroundWork.ts`, `SeriesThumbnail.tsx` |
| Startup | Decode workers start and load their codec while the first slice downloads. The manifest downloads alongside the event stream. Dialogs and JSZip load on demand (main bundle 414 → 316 KB). Hashed assets are served `immutable`. | `DecodePool.ts`, `dicomWorker.ts`, `RemoteSession.tsx`, `ViewerShell.tsx`, `DicomLoader.ts`, `server/app.ts` |
| Import | Uncompressed DICOM is stored gzip-encoded (level 1, about 44% of original size). S3 returns `Content-Encoding: gzip` and the browser inflates it, so the viewer needs no change. Up to 8 S3 uploads run in parallel. Studies imported earlier still work, just uncompressed. | `server/importer.ts`, `server/storage.ts` |
| Local files | The parse worker transfers pixel buffers instead of copying about 24 MB per batch to the main thread. | `dicomWorker.ts` |
| MPR | The volume loads through a sliding pool instead of fixed batches of 4. Progress updates every 4 slices. | `mpr/Volume.ts`, `MprViewer.tsx` |
| Cine | Cine waits for the requested slice to be on screen, so it never skips slices on a slow link. | `ViewportCanvas.tsx` |

### Bugs fixed

1. **Measurements were scaled wrong.** Pointer and overlay transforms ignored the image's fit-to-viewport scale. A 353.6 mm line measured 470.9 mm in a 682 px-tall viewport. This affected length, ROIs, probe position and angle placement. The renderer, overlay and pointer input now share one transform (`imagePlacement`).
2. **Rotation distorted the image and turned the wrong way.** The shader rotated in non-square clip space and counter-clockwise, while the overlay rotated clockwise. Rotation is now clockwise, matching the button icon, and the rotated image is refit.
3. **Orientation markers were fixed A/P/R/L.** They are now computed from ImageOrientationPatient and follow flips and rotation. They are hidden when the tag is missing. They no longer sit under the preset menu or the slice slider.
4. **Large ROIs threw an error.** `Math.min(...values)` overflowed the call stack at about 125k pixels.
5. **Probe read the wrong pixel.** It rounded to the nearest pixel edge instead of taking the pixel under the pointer (floor).
6. **Phones had no touch way to change slices.** There is a new Scroll tool: drag up or down, keyboard `K`. It is the default on touch devices in local mode. In remote mode the session's `activeTool` still decides. `scroll` was added to the remote-state schema. Note moved to the More menu so the phone toolbar stays on one row.

### Results (same harness as above; 300-slice CT; phone = 5 Mbps / 70 ms, CPU slowed 4×)

| Phone | Before | After |
|---|---|---|
| First image, raw | 2.9 s | 1.8 s (**1.4 s** gzip) |
| First image, JPEG-LS | 2.0 s | 1.5 s |
| Slice on screen after a 40-tick fast scroll, raw | 9.2 s | 4.9 s (**2.1 s** gzip) |
| Slice on screen after a 40-tick fast scroll, JPEG-LS | 2.0 s | 1.7 s |
| Jump to last slice, raw | 10.1 s | 1.0 s (0.5 s gzip) |
| Jump to last slice, JPEG-LS | 1.9 s | 0.5 s |
| Data used in the session, raw | 16.2 MB | 6.1 MB (4.0 MB gzip) |
| Local folder open (300 raw files) | 2.3 s, 1.1 s of long tasks | 1.3 s, 0.3 s |

| Desktop (50 Mbps / 40 ms) | Before | After |
|---|---|---|
| First image, raw / JPEG-LS | 0.67 / 0.72 s | 0.58 / 0.64 s (0.52 s gzip) |
| Jump to last slice, raw / JPEG-LS | 0.26 / 0.16 s | 0.20 / 0.17 s |
| MPR volume ready, JPEG-LS (A/B, same run) | 16.2 s | 11.0 s |

Checks: `tsc` (app and server), 46/46 tests, `npm run build` and lint pass. The one lint warning in `MprViewer.tsx` was already there.

### Still open
- A radiologist should check measurements drawn before this fix. Measurements saved in remote-session state are in image pixels and were computed with the wrong scale.
- Remote sessions start on the server's `activeTool` (`windowLevel`), so phones there need one tap on Scroll. Changing the server default would change behaviour for every portal.
- MPR still builds its 3D texture on the main thread (about 270 ms long task on desktop). Moving it to a worker is item 1 above.
- `test-data/mkct.cjs` (git-ignored) fails lint because it is a CommonJS script. Add `test-data` to the ESLint ignores or leave it.
