import { useEffect, useState } from 'react';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';

export function StatusBar(): JSX.Element {
  const source = useStudyStore((state) => state.imageSource);
  const renderTimeMs = useViewerStore((state) => state.renderTimeMs);
  // Cache size is sampled twice a second instead of re-rendering on every decoded frame.
  const [metrics, setMetrics] = useState(() => source?.metrics());
  useEffect(() => {
    setMetrics(source?.metrics());
    const timer = window.setInterval(() => setMetrics(source?.metrics()), 500);
    return () => window.clearInterval(timer);
  }, [source]);
  const mb = metrics ? (metrics.memoryBytes / (1024 * 1024)).toFixed(1) : '0.0';
  return (
    <footer className="status-bar">
      <span>{source?.mode === 'remote' ? 'Connected study' : 'Local mode'}</span>
      <span>{source?.mode === 'remote' ? 'Images loaded on demand' : 'Files remain on this device'}</span>
      <span className="status-optional">{metrics?.framesCached ?? 0} frames cached</span>
      <span className="status-optional">{mb} MB estimated</span>
      <span>Render {renderTimeMs.toFixed(1)} ms</span>
    </footer>
  );
}
