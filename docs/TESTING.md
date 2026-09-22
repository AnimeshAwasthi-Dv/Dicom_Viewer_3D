# Manual Testing Checklist

Run:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

## Local Loading

- Single DICOM file opens without a server
- Multi-file CT folder indexes all valid instances
- MR series groups independently from CT or scout images
- X-Ray / CR / DX image opens as a single-image series
- Invalid files are reported without crashing the viewer
- One corrupted DICOM in a large folder does not prevent valid images from loading

## Rendering

- MONOCHROME2 displays normal grayscale
- MONOCHROME1 displays inverted grayscale
- CT values preserve HU through Rescale Slope and Rescale Intercept
- Unsupported compressed transfer syntax shows a professional error with the UID
- Missing PixelData is reported without crashing

## Interaction

- Mouse wheel scrolls slices
- Left drag changes window/level
- Middle drag pans
- Right drag zooms
- Toolbar can switch WL, pan, zoom, length, angle, ROI, and probe
- Invert, rotate, horizontal flip, vertical flip, reset, and cine work
- Keyboard shortcuts: W, P, Z, M, A, R, I, Space, Escape, Arrow Up, Arrow Down, Home, End

## Measurements

- Length displays millimeters when PixelSpacing exists
- Length falls back to pixels when PixelSpacing is missing
- Rectangle ROI shows area, mean, min, max, and standard deviation
- Ellipse ROI shows area, mean, min, max, and standard deviation
- CT ROI statistics are reported in HU
- Probe displays X, Y, value, and HU where applicable
- Measurements remain visible after leaving and returning to the source slice

## Performance

- Large CT series shows the first usable image quickly
- Nearby frames continue loading without blocking interaction
- Rapid scrolling remains responsive
- Refresh returns to a clean local viewer state

