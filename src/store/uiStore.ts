import { create } from 'zustand';
import type { ToolId } from '../viewer/tools/BaseTool';

interface UiStore {
  activeTool: ToolId;
  roiMode: 'rectangleRoi' | 'ellipseRoi';
  shortcutsOpen: boolean;
  dicomTagsOpen: boolean;
  exportOpen: boolean;
  mprOpen: boolean;
  setActiveTool(tool: ToolId): void;
  setRoiMode(mode: 'rectangleRoi' | 'ellipseRoi'): void;
  setShortcutsOpen(open: boolean): void;
  toggleShortcuts(): void;
  setDicomTagsOpen(open: boolean): void;
  toggleDicomTags(): void;
  setExportOpen(open: boolean): void;
  toggleExport(): void;
  setMprOpen(open: boolean): void;
  toggleMpr(): void;
}

export const useUiStore = create<UiStore>((set) => ({
  // Phones have no scroll wheel, so a one-finger drag changes slices by default there, as in other mobile viewers.
  activeTool: typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'scroll' : 'windowLevel',
  roiMode: 'rectangleRoi',
  shortcutsOpen: false,
  dicomTagsOpen: false,
  exportOpen: false,
  mprOpen: false,
  setActiveTool: (activeTool) => set({ activeTool }),
  setRoiMode: (roiMode) => set({ roiMode, activeTool: roiMode }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleShortcuts: () => set((state) => ({ shortcutsOpen: !state.shortcutsOpen })),
  setDicomTagsOpen: (dicomTagsOpen) => set({ dicomTagsOpen }),
  toggleDicomTags: () => set((state) => ({ dicomTagsOpen: !state.dicomTagsOpen })),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  toggleExport: () => set((state) => ({ exportOpen: !state.exportOpen })),
  setMprOpen: (mprOpen) => set({ mprOpen }),
  toggleMpr: () => set((state) => ({ mprOpen: !state.mprOpen }))
}));
