import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { DicomLoader } from '../../viewer/dicom/DicomLoader';
import { LocalFileImageSource } from '../../viewer/dicom/LocalFileImageSource';
import { choosePrimarySeries } from '../../viewer/study/StudyManager';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';

export function LocalLoader(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const setLoading = useStudyStore((state) => state.setLoading);
  const setSource = useStudyStore((state) => state.setSource);
  const addError = useStudyStore((state) => state.addError);
  const assignSeries = useViewerStore((state) => state.assignSeries);

  const load = async (fileList: FileList | File[]): Promise<void> => {
    const files = Array.from(fileList).filter((file) => file.size > 0);
    if (files.length === 0) return;
    try {
      const parsed = await new DicomLoader().loadFiles(files, setLoading);
      const source = new LocalFileImageSource(parsed);
      const studies = await source.getStudyMetadata();
      const primary = choosePrimarySeries(studies);
      if (!primary) {
        source.dispose();
        setLoading(undefined);
        addError('No loadable DICOM, JPEG, or PNG images were found in that selection.');
        return;
      }
      setSource(source, studies);
      useStudyStore.getState().selectSeries(primary.id);
      assignSeries('viewport-1', primary.id);
    } catch (error) {
      addError(error instanceof Error ? error.message : 'Unable to load selected files.');
      setLoading(undefined);
    }
  };

  return (
    <div
      className={`empty-state ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void load(event.dataTransfer.files);
      }}
    >
      <div className="empty-mark">DECXPERT VIEWER</div>
      <h1>Drop DICOM, JPEG, PNG, or ZIP files here</h1>
      <p>Local mode · Files remain on this device</p>
      <div className="loader-actions">
        <button onClick={() => inputRef.current?.click()}><Upload size={16} /> Open Images / ZIP</button>
        <button className="secondary" onClick={() => folderRef.current?.click()}>Open Folder</button>
      </div>
      <span className="support">Supports DICOM (CT · MR · CR · DX) · JPG · JPEG · PNG</span>
      <input ref={inputRef} hidden type="file" multiple accept=".dcm,.dicom,.jpg,.jpeg,.png,.zip,application/dicom,image/jpeg,image/png,application/zip" onChange={(event) => event.target.files && void load(event.target.files)} />
      <input ref={folderRef} hidden type="file" multiple webkitdirectory="" onChange={(event) => event.target.files && void load(event.target.files)} />
    </div>
  );
}
