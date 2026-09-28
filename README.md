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

## Imaging Engine

Rendering, decoding, tools and MPR run on [Cornerstone3D](https://www.cornerstonejs.org/) (the engine behind OHIF, also used by the RadAgent viewer), inside this React application. The engine is shared by three study sources:

- **Local files**: files, folders, ZIPs and drag/drop; nothing leaves the device.
- **Viewer service sessions** (`?session=<id>#token=…`): S3 ZIP imports with remote control, see the [EC2 guide](docs/ec2-viewer-service.md).
- **DICOMweb** (`?study=<StudyInstanceUID>`, optional same-origin `&dicomweb=<root>`, default `/dicom-web`): Orthanc behind the RadAgent imaging gateway, which serves this build at `/rad-viewer/`. In development, `DICOMWEB_PROXY=http://localhost:8042 npm run dev` proxies `/dicom-web` to a local server.

## Supported DICOM Features

- CT, MR, CR/DX, MG, US, XA, NM, PT, secondary capture; greyscale and colour (RGB, YBR, palette colour)
- Multi-frame images (cine ultrasound, XA, enhanced objects) with cine playback
- Transfer syntaxes: implicit/explicit little endian, big endian, deflate, JPEG Baseline/Extended/Lossless, JPEG-LS, JPEG 2000, HTJ2K, RLE
- Geometry-aware slice sorting, rescale to modality values (CT HU), VOI presets from the file and per modality
- Window/level, stack scroll, pan, zoom, rotate, flip, invert, 1x1–2x2 layouts, orientation markers
- Measurements: length, angle, Cobb angle, bidirectional (long/short axis), probe, arrow annotation, rectangle, ellipse, circle, freehand, spline and livewire ROIs with statistics
- GPU MPR with linked crosshairs, slab MIP/MinIP/average, and 3D volume rendering
- PNG capture with measurements burned in; DICOM tag browser

## Known Limitations

- No clinician identity provider, reporting, scheduling or billing; access comes from the portal (viewer-service sessions) or the RadAgent gateway (DICOMweb)
- Measurements last for the session; they are not saved as DICOM SR
- Low-resolution previews built at import are not yet shown while full slices download
- MPR and 3D need the whole series in memory: very large CT series remain limited by browser and GPU memory on phones

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
