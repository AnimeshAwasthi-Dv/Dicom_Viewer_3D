import { Download, FileJson, Image, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';

function safeName(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportDialog(): JSX.Element | null {
  const open = useUiStore((state) => state.exportOpen);
  const setOpen = useUiStore((state) => state.setExportOpen);
  const { studies, selectedSeriesId } = useStudyStore();
  const { viewports } = useViewerStore();
  const study = studies[0];
  const series = selectCurrentSeries(studies, selectedSeriesId);
  const viewport = viewports[0];
  const currentInstance = series?.instances[viewport.instanceIndex];

  if (!open) return null;

  const studyFileStem = safeName(study?.patientId ?? study?.patientName, 'decxpert-study');
  const seriesFileStem = safeName(series?.description, 'decxpert-series');

  const exportViewport = (): void => {
    window.dispatchEvent(new CustomEvent('viewer:export-screenshot'));
    setOpen(false);
  };

  const exportSeriesManifest = (): void => {
    if (!series) return;
    downloadJson(`${studyFileStem}-${seriesFileStem}-series.json`, {
      exportedBy: 'DecXpert Viewer',
      exportedAt: new Date().toISOString(),
      study: {
        studyInstanceUID: series.studyInstanceUID,
        patientName: study?.patientName,
        patientId: study?.patientId,
        bodyPartExamined: study?.bodyPartExamined,
        studyDate: study?.studyDate,
        studyDescription: study?.studyDescription
      },
      series: {
        seriesInstanceUID: series.seriesInstanceUID,
        description: series.description,
        modality: series.modality,
        seriesNumber: series.seriesNumber,
        imageCount: series.instances.length
      },
      currentInstance: currentInstance?.metadata,
      instances: series.instances.map((instance) => instance.metadata)
    });
    setOpen(false);
  };

  const exportStudyManifest = (): void => {
    if (!study) return;
    downloadJson(`${studyFileStem}-study.json`, {
      exportedBy: 'DecXpert Viewer',
      exportedAt: new Date().toISOString(),
      study: {
        studyInstanceUID: study.studyInstanceUID,
        patientName: study.patientName,
        patientId: study.patientId,
        patientSex: study.patientSex,
        patientAge: study.patientAge,
        bodyPartExamined: study.bodyPartExamined,
        studyDate: study.studyDate,
        studyDescription: study.studyDescription,
        modality: study.modality
      },
      series: study.series.map((item) => ({
        seriesInstanceUID: item.seriesInstanceUID,
        description: item.description,
        modality: item.modality,
        seriesNumber: item.seriesNumber,
        imageCount: item.instances.length,
        instances: item.instances.map((instance) => instance.metadata)
      }))
    });
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="export-modal" role="dialog" aria-modal="true" aria-label="Export study" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>Export</p>
            <h2>Export Study</h2>
          </div>
          <button title="Close" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <div className="export-options">
          <button disabled={!currentInstance} onClick={exportViewport}>
            <Image size={18} />
            <span>
              <strong>Viewport PNG</strong>
              <small>Save the current image view with window, zoom, and orientation.</small>
            </span>
          </button>
          <button disabled={!series} onClick={exportSeriesManifest}>
            <FileJson size={18} />
            <span>
              <strong>Selected Series JSON</strong>
              <small>Export metadata for the open series and current image.</small>
            </span>
          </button>
          <button disabled={!study} onClick={exportStudyManifest}>
            <Download size={18} />
            <span>
              <strong>Study JSON</strong>
              <small>Export metadata for all loaded series in this study.</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
