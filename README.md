# DecXpert Viewer

A local-first, web-based DICOM viewer foundation branded as DecXpert Viewer, built with React, TypeScript, Vite, Zustand, Web Workers, and a WebGL2 grayscale renderer.

The repository also includes an EC2-ready API and ZIP import worker for private S3 studies, Redis-backed viewer sessions, and live remote control from another service. See the [EC2 deployment and API guide](docs/ec2-viewer-service.md), [.env.example](.env.example), and [portal integration example](examples/control-viewer.mjs). Local file viewing continues to work without the backend.

## Requirements

- Windows 10/11
- Node.js 22 or newer
- A modern Chromium, Edge, or Firefox browser with WebGL2 support

## Run Locally

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

If PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd install
npm.cmd run dev
```

## Build And Test

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## Supported DICOM Features

- Local browser file, multi-file, folder, and drag/drop loading
- Study and series grouping
- Geometry-aware slice sorting using Image Position Patient and Image Orientation Patient when available
- Uncompressed grayscale rendering
- MONOCHROME1 and MONOCHROME2
- Rescale Slope and Rescale Intercept for modality values, including CT HU
- Window/level, stack scroll, pan, zoom, rotate, flip, invert
- Length, angle, rectangle ROI, ellipse ROI, and probe measurements
- PixelSpacing-aware length measurements
- ROI statistics over modality values
- Cine playback with configurable FPS in code/state

## Transfer Syntaxes

Currently enabled:

- Implicit VR Little Endian: `1.2.840.10008.1.2`
- Explicit VR Little Endian: `1.2.840.10008.1.2.1`
- JPEG-LS Lossless: `1.2.840.10008.1.2.4.80`

Other compressed syntaxes are detected and reported without crashing. The codec architecture is prepared for JPEG, JPEG Lossless, JPEG2000, HTJ2K, and RLE.

## Known Limitations

- No PACS/DICOMweb, clinician identity provider, reporting, scheduling or billing; the service uses scoped session tokens and expects identity/study authorization from the calling portal
- JPEG-LS is supported through CharLS; other compressed transfer syntaxes are not decoded yet
- No multiframe DICOM support yet
- Orientation markers are placeholders pending full patient orientation mapping
- Series thumbnails use a generated diagnostic placeholder instead of decoded miniature rendering
- WebGPU, MPR, 3D, fusion, SEG, and SR are intentionally out of scope for this milestone

## Project Architecture

```text
src/
  app/
  components/
  store/
  types/
  viewer/
    cache/
    codecs/
    core/
    dicom/
    measurements/
    rendering/
    study/
    tools/
    workers/
```

Place private local test files in:

```text
test-data/
```

That folder is ignored by git. Files are read by the browser and are not uploaded anywhere.
