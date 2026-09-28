import { useEffect, useState } from 'react';
import { cache } from '@cornerstonejs/core';
import { useStudyStore } from '../../store/studyStore';

const MODE_LABEL = {
  local: ['Local mode', 'Files remain on this device'],
  remote: ['Connected study', 'Images loaded on demand'],
  dicomweb: ['PACS study', 'Images streamed from the image server']
} as const;

export function StatusBar(): JSX.Element {
  const source = useStudyStore((state) => state.imageSource);
  // Cache size is sampled twice a second instead of re-rendering on every decoded image.
  const [cachedBytes, setCachedBytes] = useState(0);
  useEffect(() => {
    const sample = () => setCachedBytes(cache.getCacheSize());
    sample();
    const timer = window.setInterval(sample, 500);
    return () => window.clearInterval(timer);
  }, [source]);
  const [mode, detail] = MODE_LABEL[source?.mode ?? 'local'];
  return (
    <footer className="status-bar">
      <span>{mode}</span>
      <span>{detail}</span>
      <span className="status-optional">{(cachedBytes / (1024 * 1024)).toFixed(1)} MB cached</span>
      <span className="status-optional">GPU rendering · Cornerstone3D</span>
    </footer>
  );
}
