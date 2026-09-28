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
      const loaded = await new DicomLoader().loadFiles(files, setLoading);
      const source = new LocalFileImageSource(loaded);
      const studies = await source.getStudyMetadata();
      setSource(source, studies);
      const primary = choosePrimarySeries(studies);
      if (primary) {
        useStudyStore.getState().selectSeries(primary.id);
        assignSeries('viewport-1', primary.id);
      }
      else addError('No loadable DICOM images were found in that selection.');
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
      <h1>Drop a DICOM study or ZIP here</h1>
      <p>Local mode · Files remain on this device</p>
      <div className="loader-actions">
        <button onClick={() => inputRef.current?.click()}><Upload size={16} /> Open DICOM / ZIP</button>
        <button className="secondary" onClick={() => folderRef.current?.click()}>Open Folder</button>
      </div>
      <span className="support">CT · MR · CR · DX · MG · US · XA · colour and multi-frame · compressed DICOM</span>
      <input ref={inputRef} hidden type="file" multiple accept=".dcm,.dicom,.zip,application/dicom,application/zip" onChange={(event) => event.target.files && void load(event.target.files)} />
      <input ref={folderRef} hidden type="file" multiple webkitdirectory="" onChange={(event) => event.target.files && void load(event.target.files)} />
    </div>
  );
}
