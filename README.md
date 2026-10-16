# DecXpert Viewer

A local-first, web-based DICOM and image viewer branded as DecXpert Viewer, built with React, TypeScript, Vite, Zustand, Web Workers, and a WebGL2 renderer.

The repository also includes an EC2-ready API and import worker for private S3 studies, persistent SQLite sessions and import jobs, and live remote control from another service. No Redis service is required. The supplied deployment configuration uses `https://dicom.admindectrocel.online` and bucket `animesh-arn` in `us-east-1`, reading `test/hospitals/` and `test/studies/`. See the [EC2 deployment and API guide](docs/ec2-viewer-service.md), [.env.example](.env.example), and [portal integration example](examples/control-viewer.mjs). Local file viewing continues to work without the backend.

For a portal opening studies already in S3, use `POST /api/v1/viewer-links`. It queues an import or returns a ready viewer URL. See the [portal API integration guide](docs/portal-integration.md) for request examples, the reusable Node.js client and an EC2 smoke-test command.

## Requirements

- Windows 10/11
- Node.js 24 or newer (server persistence uses Node's built-in SQLite module)
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

### JPEG and PNG images

Local mode also opens `.jpg`, `.jpeg`, and `.png` images through the file picker, drag/drop, folders, and ZIP archives (including mixed DICOM/image archives). Each ordinary image appears as a separate series named after its file. Original colors are preserved in the viewport and thumbnails; PNG transparency is displayed over black, and JPEG EXIF orientation is applied by the browser.

Pan, zoom, rotation, flip, inversion, window/level, and annotations work on these images. Length and area measurements use pixels because ordinary images have no DICOM calibration; probes and ROI statistics report luminance. They do not provide patient orientation, DICOM tags, or a 3D volume. The server-side S3 importer also supports these images, individually or inside mixed ZIP archives; the API accepts explicit object keys or a study-folder prefix. Raster images are limited to 64 megapixels.

### DICOM encodings

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
