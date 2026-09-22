import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import type { DicomMetadata } from '../../types/dicom';

export function DicomTagsDialog(): JSX.Element | null {
  const [query, setQuery] = useState('');
  const open = useUiStore((state) => state.dicomTagsOpen);
  const setOpen = useUiStore((state) => state.setDicomTagsOpen);
  const { studies, selectedSeriesId, imageSource } = useStudyStore();
  const [loadedMetadata, setLoadedMetadata] = useState<DicomMetadata>();
  const viewport = useViewerStore((state) => state.viewports[0]);
  const series = selectCurrentSeries(studies, selectedSeriesId);
  const indexedMetadata = series?.instances[viewport.instanceIndex]?.metadata;
  const metadata = loadedMetadata?.sopInstanceUID === indexedMetadata?.sopInstanceUID ? loadedMetadata : indexedMetadata;
  useEffect(() => {
    if (!open || !imageSource || !indexedMetadata || indexedMetadata.rawTags) return;
    let cancelled = false;
    imageSource.getFrame(indexedMetadata.sopInstanceUID).then(frame => {
      if (!cancelled) setLoadedMetadata(frame.metadata);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, imageSource, indexedMetadata]);
  const tags = useMemo(() => metadata?.rawTags ?? [], [metadata?.rawTags]);
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
