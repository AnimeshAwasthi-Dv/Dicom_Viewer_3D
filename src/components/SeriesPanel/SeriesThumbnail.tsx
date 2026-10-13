import { useEffect, useRef, useState } from 'react';
import { Enums, utilities as csUtilities } from '@cornerstonejs/core';
import { useStudyStore } from '../../store/studyStore';
import type { Series } from '../../viewer/study/Series';
import { whenIdle } from '../../viewer/cache/BackgroundWork';
import { initCornerstone } from '../../viewer/cornerstone/init';
import { imageCount } from '../../viewer/study/StudyManager';

export function SeriesThumbnail({ series }: { series: Series }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageSource = useStudyStore((state) => state.imageSource);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSource) return;
    const abort = new AbortController();
    setFailed(false);
    // Waits for the first diagnostic image and for the user to stop scrolling, then renders the middle image with
    // its own window, at thumbnail priority.
    whenIdle(async () => {
      await initCornerstone();
      const loaded = await imageSource.ensureSeries(series);
      const ids = imageSource.imageIds(loaded);
      const imageId = ids[Math.floor(ids.length / 2)];
      if (!imageId || abort.signal.aborted) return;
      await csUtilities.loadImageToCanvas({ canvas, imageId, thumbnail: true, requestType: Enums.RequestType.Thumbnail });
      // Cornerstone pins the canvas to 256 CSS pixels; the card sizes it instead, or only its corner shows.
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    }, abort.signal).catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    });
    return () => abort.abort();
    // A DICOMweb series gets a new object when its instance list arrives; that alone isn't a reason to start over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSource, series.id]);

  return (
    <div className="series-preview">
      <canvas ref={canvasRef} width={128} height={128} />
      {failed && <span className="series-preview-fallback">{series.modality}</span>}
      <span className="series-count">{imageCount(series)}</span>
    </div>
  );
}
