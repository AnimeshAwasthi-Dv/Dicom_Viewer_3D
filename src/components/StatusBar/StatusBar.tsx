import { useStudyStore } from '../../store/studyStore';

export function StatusBar({ frameCount, renderTimeMs }: { frameCount: number; renderTimeMs: number }): JSX.Element {
  const source = useStudyStore((state) => state.imageSource);
  const metrics = source?.metrics();
  const mb = metrics ? (metrics.memoryBytes / (1024 * 1024)).toFixed(1) : '0.0';
  return (
    <footer className="status-bar">
      <span>{source?.mode === 'remote' ? 'Connected study' : 'Local mode'}</span>
      <span>{source?.mode === 'remote' ? 'Images loaded on demand' : 'Files remain on this device'}</span>
      <span>{metrics?.framesCached ?? frameCount} frames cached</span>
      <span>{mb} MB estimated</span>
      <span>Render {renderTimeMs.toFixed(1)} ms</span>
    </footer>
  );
}
