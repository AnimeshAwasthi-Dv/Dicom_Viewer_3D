import { Menu } from 'lucide-react';
import type { Study } from '../../viewer/study/Study';
import type { Series } from '../../viewer/study/Series';

function dateLabel(value?: string): string {
  if (!value || value.length !== 8) return value ?? 'No study loaded';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
}

function ageSexLabel(study?: Study): string {
  const age = study?.patientAge?.replace(/^0+/, '') ?? '';
  const sex = study?.patientSex ?? '';
  if (age && sex) return `${age}/${sex}`;
  return age || sex || 'Age/Sex unavailable';
}

export function PatientHeader({
  study,
  series,
  seriesOpen,
  onToggleSeries
}: {
  study?: Study;
  series?: Series;
  seriesOpen: boolean;
  onToggleSeries(): void;
}): JSX.Element {
  const description = study?.studyDescription ?? study?.bodyPartExamined ?? series?.description ?? 'Description unavailable';
  return (
    <header className="patient-header">
      <button className="series-drawer-toggle" title="Show or hide series" aria-label="Toggle series panel" aria-expanded={seriesOpen} onClick={onToggleSeries}>
        <Menu size={20} />
      </button>
      <div className="brand-block">
        <strong>DecXpert Viewer</strong>
        <span>{study ? 'Diagnostic workstation' : 'Local DICOM workstation'}</span>
      </div>
      <div className="patient-block">
        <strong>{study?.patientName ?? 'No patient selected'}</strong>
        <span>{study?.patientId ?? 'No patient selected'}</span>
      </div>
      <div className="study-block">
        <span>{ageSexLabel(study)}</span>
        <span>{description}</span>
      </div>
      <div className="modality-block">
        <span>{dateLabel(study?.studyDate)}</span>
        <strong>{study?.modality ?? 'Local mode'}</strong>
      </div>
    </header>
  );
}
