import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import type { DicomTag } from '../../types/dicom';

export function DicomTagsDialog(): JSX.Element | null {
  const [query, setQuery] = useState('');
  const open = useUiStore((state) => state.dicomTagsOpen);
  const setOpen = useUiStore((state) => state.setDicomTagsOpen);
  const studies = useStudyStore((state) => state.studies);
  const selectedSeriesId = useStudyStore((state) => state.selectedSeriesId);
  const imageSource = useStudyStore((state) => state.imageSource);
  const viewport = useViewerStore((state) => state.viewports[0]);
  const series = selectCurrentSeries(studies, viewport.seriesId ?? selectedSeriesId);
  const imageId = series && imageSource ? imageSource.imageIds(series)[viewport.instanceIndex] : undefined;
  const [loaded, setLoaded] = useState<{ imageId: string; tags: DicomTag[] }>();
  useEffect(() => {
    if (!open || !imageSource || !imageId) return;
    let cancelled = false;
    // Read from the file (or DICOMweb metadata) of the image on screen.
    imageSource.tags(imageId).then((tags) => { if (!cancelled) setLoaded({ imageId, tags }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, imageSource, imageId]);
  const metadata = imageId ? imageSource?.locate(imageId)?.instance.metadata : undefined;
  const tags = useMemo(() => (loaded?.imageId === imageId ? loaded?.tags : undefined) ?? [], [imageId, loaded]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTags = useMemo(() => {
    if (!normalizedQuery) return tags;
    return tags.filter((tag) => (
      tag.tag.toLowerCase().includes(normalizedQuery) ||
      tag.name.toLowerCase().includes(normalizedQuery) ||
      (tag.vr ?? '').toLowerCase().includes(normalizedQuery) ||
      String(tag.length).includes(normalizedQuery) ||
      tag.value.toLowerCase().includes(normalizedQuery)
    ));
  }, [normalizedQuery, tags]);
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="tags-modal" role="dialog" aria-modal="true" aria-label="DICOM tags" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>Current Instance</p>
            <h2>DICOM Tags</h2>
          </div>
          <button title="Close" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <div className="tag-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search tags, names, VR, length, or values"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && <button title="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
        </div>
        <div className="tag-table">
          {metadata ? (
            <>
              <div className="tag-row tag-row-head">
                <span>Tag</span>
                <span>Name</span>
                <span>VR</span>
                <span>Length</span>
                <span>Value</span>
              </div>
              {filteredTags.map((tag) => (
                <div className="tag-row" key={`${tag.tag}-${tag.name}`}>
                  <code>{tag.tag}</code>
                  <span>{tag.name}</span>
                  <span>{tag.vr ?? '--'}</span>
                  <span>{tag.length}</span>
                  <code>{tag.value || '--'}</code>
                </div>
              ))}
              {tags.length === 0 && <p className="muted">No readable metadata tags found for this instance</p>}
              {tags.length > 0 && filteredTags.length === 0 && <p className="muted">No tags match that search</p>}
            </>
          ) : <p className="muted">No instance selected</p>}
        </div>
      </section>
    </div>
  );
}
