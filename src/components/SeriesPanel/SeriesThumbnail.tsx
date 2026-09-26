import { useEffect, useRef, useState } from 'react';
import type { DecodedFrame } from '../../types/dicom';
import { useStudyStore } from '../../store/studyStore';
import type { Series } from '../../viewer/study/Series';
import { whenIdle } from '../../viewer/cache/BackgroundWork';
import { RequestPriority } from '../../viewer/cache/FrameRequestQueue';

function displayWindow(frame: DecodedFrame): { width: number; center: number } {
  if (frame.metadata.windowWidth && frame.metadata.windowWidth > 1 && frame.metadata.windowCenter !== undefined) {
    return { width: frame.metadata.windowWidth, center: frame.metadata.windowCenter };
  }
  const width = Math.max(1, frame.max - frame.min);
  return { width, center: frame.min + width / 2 };
}

function renderThumbnail(canvas: HTMLCanvasElement, frame: DecodedFrame): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const outputWidth = canvas.width;
  const outputHeight = canvas.height;
  const imageData = context.createImageData(outputWidth, outputHeight);
  const { width, center } = displayWindow(frame);
  const low = center - 0.5 - (width - 1) / 2;
  const high = center - 0.5 + (width - 1) / 2;
  const imageAspect = frame.metadata.columns / frame.metadata.rows;
  const outputAspect = outputWidth / outputHeight;
  const drawnWidth = imageAspect > outputAspect ? outputWidth : Math.round(outputHeight * imageAspect);
  const drawnHeight = imageAspect > outputAspect ? Math.round(outputWidth / imageAspect) : outputHeight;
  const offsetX = Math.floor((outputWidth - drawnWidth) / 2);
  const offsetY = Math.floor((outputHeight - drawnHeight) / 2);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const outputIndex = (y * outputWidth + x) * 4;
      imageData.data[outputIndex + 3] = 255;
      if (x < offsetX || x >= offsetX + drawnWidth || y < offsetY || y >= offsetY + drawnHeight) continue;
      const sourceX = Math.min(frame.metadata.columns - 1, Math.max(0, Math.floor(((x - offsetX) / drawnWidth) * frame.metadata.columns)));
      const sourceY = Math.min(frame.metadata.rows - 1, Math.max(0, Math.floor(((y - offsetY) / drawnHeight) * frame.metadata.rows)));
      const value = frame.modalityPixels[sourceY * frame.metadata.columns + sourceX];
      let gray = Math.round(Math.min(1, Math.max(0, (value - low) / Math.max(1, high - low))) * 255);
      if (frame.metadata.photometricInterpretation === 'MONOCHROME1') gray = 255 - gray;
      imageData.data[outputIndex] = gray;
      imageData.data[outputIndex + 1] = gray;
      imageData.data[outputIndex + 2] = gray;
    }
  }
  context.putImageData(imageData, 0, 0);
}

export function SeriesThumbnail({ series }: { series: Series }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageSource = useStudyStore((state) => state.imageSource);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const instance = series.instances.find((item) => item.id === series.thumbnailInstanceId) ?? series.instances[Math.floor(series.instances.length / 2)];
    if (!canvas || !imageSource || !instance) return;
    const abort = new AbortController();
    setFailed(false);
    // Waits for the first diagnostic image and for the user to stop scrolling, then loads at the lowest priority.
    whenIdle(() => imageSource.getFrame(instance.id, { priority: RequestPriority.Thumbnail, signal: abort.signal }), abort.signal)
      .then((frame) => {
        if (!abort.signal.aborted) renderThumbnail(canvas, frame);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [imageSource, series]);

  return (
    <div className="series-preview">
      <canvas ref={canvasRef} width={128} height={96} />
      {failed && <span className="series-preview-fallback">{series.modality}</span>}
      <span className="series-count">{series.instances.length}</span>
    </div>
  );
}
