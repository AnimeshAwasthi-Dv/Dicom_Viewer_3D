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

export function PatientHeader({ study, series }: { study?: Study; series?: Series }): JSX.Element {
  const description = study?.studyDescription ?? study?.bodyPartExamined ?? series?.description ?? 'Description unavailable';
  const image = series?.instances[0]?.metadata;
  if (image?.imageFormat) {
    return (
      <header className="patient-header">
        <div className="brand-block"><strong>DecXpert Viewer</strong><span>Image viewer</span></div>
        <div className="patient-block"><strong>{image.fileName}</strong><span>{image.columns} × {image.rows} pixels</span></div>
        <div className="study-block"><span>Measurements in pixels</span><span>{description}</span></div>
        <div className="modality-block"><strong>{image.imageFormat.toUpperCase()}</strong></div>
      </header>
    );
  }
  return (
    <header className="patient-header">
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
