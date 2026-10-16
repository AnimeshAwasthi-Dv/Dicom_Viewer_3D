import { create } from 'zustand';
import type { ImageSource } from '../viewer/dicom/ImageSource';
import type { Series } from '../viewer/study/Series';
import type { Study } from '../viewer/study/Study';
import { resetBackgroundWork } from '../viewer/cache/BackgroundWork';
import type { StudyManifest } from '../types/remote';

interface StudyStore {
  imageSource?: ImageSource;
  studies: Study[];
  selectedStudyId?: string;
  selectedSeriesId?: string;
  loading?: { phase: string; indexed: number; total: number };
  errors: string[];
  remoteImportStatus?: StudyManifest['importStatus'];
  setLoading(loading?: StudyStore['loading']): void;
  setSource(imageSource: ImageSource, studies: Study[]): void;
  selectSeries(seriesId: string): void;
  addError(error: string): void;
  reset(): void;
}

export const useStudyStore = create<StudyStore>((set) => ({
  studies: [],
  errors: [],
  setLoading: (loading) => set({ loading }),
  setSource: (imageSource, studies) =>
    set((state) => {
      // Release the previous study's decode workers and cached frames.
      if (state.imageSource && state.imageSource !== imageSource) state.imageSource.dispose?.();
      // The new study's thumbnails wait for its first image.
      resetBackgroundWork();
      return {
      imageSource,
      remoteImportStatus: undefined,
      studies,
      selectedStudyId: studies[0]?.id,
      selectedSeriesId: studies[0]?.series[0]?.id,
      loading: undefined,
      errors: studies.flatMap((study) => study.errors)
      };
    }),
  selectSeries: (seriesId) => set(state => ({ selectedSeriesId: seriesId, selectedStudyId: state.studies.find(study => study.series.some(series => series.id === seriesId))?.id })),
  addError: (error) => set((state) => ({ errors: [...state.errors.slice(-4), error] })),
  reset: () => set({ imageSource: undefined, studies: [], selectedStudyId: undefined, selectedSeriesId: undefined, loading: undefined, errors: [], remoteImportStatus: undefined })
}));

export function selectCurrentSeries(studies: Study[], seriesId?: string): Series | undefined {
  return studies.flatMap((study) => study.series).find((series) => series.id === seriesId);
}
