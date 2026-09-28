import { useViewerStore } from '../../store/viewerStore';

const presetsByModality: Record<string, Array<{ name: string; ww: number; wl: number }>> = {
  CT: [
    { name: 'Brain', ww: 80, wl: 40 },
    { name: 'Subdural', ww: 130, wl: 50 },
    { name: 'Stroke', ww: 40, wl: 40 },
    { name: 'Bone', ww: 2500, wl: 480 },
    { name: 'Lung', ww: 1500, wl: -600 },
    { name: 'Mediastinum', ww: 350, wl: 50 },
    { name: 'Abdomen', ww: 400, wl: 40 },
    { name: 'Liver', ww: 150, wl: 90 }
  ],
  MR: [
    { name: 'Soft Tissue', ww: 600, wl: 300 },
    { name: 'Brain', ww: 400, wl: 200 },
    { name: 'Spine', ww: 700, wl: 350 }
  ],
  PT: [
    { name: 'PET SUV', ww: 10, wl: 5 },
    { name: 'Low SUV', ww: 5, wl: 2.5 }
  ],
  NM: [
    { name: 'Nuclear', ww: 255, wl: 128 }
  ],
  US: [
    { name: 'Ultrasound', ww: 255, wl: 128 }
  ],
  DEFAULT: [
    { name: '8-bit', ww: 255, wl: 128 },
    { name: '12-bit', ww: 4095, wl: 2048 },
    { name: '16-bit', ww: 65535, wl: 32768 }
  ]
};

function presetsFor(modality?: string): Array<{ name: string; ww: number; wl: number }> {
  const normalized = modality?.toUpperCase();
  if (normalized && presetsByModality[normalized]) return presetsByModality[normalized];
  if (normalized === 'CR' || normalized === 'DX' || normalized === 'MG' || normalized === 'XA' || normalized === 'RF' || normalized === 'SC') return presetsByModality.DEFAULT;
  return presetsByModality.DEFAULT;
}

type Preset = { name: string; ww: number; wl: number };

/** The file's own VOI windows first (with their explanations), then the modality's standard presets. */
export function WindowPresets({ viewportId, modality, voiPresets }: { viewportId: string; modality?: string; voiPresets?: Array<{ center: number; width: number; explanation?: string }> }): JSX.Element {
  const setWindow = useViewerStore((state) => state.setWindow);
  const fromFile: Preset[] = (voiPresets ?? []).map((preset, index) => ({
    name: `${preset.explanation || `DICOM ${index + 1}`} · C${Math.round(preset.center)}/W${Math.round(preset.width)}`,
    ww: preset.width,
    wl: preset.center
  }));
  const presets = [...fromFile, ...presetsFor(modality)];
  return (
    // Resets to "Preset" after each choice, so choosing the same preset again re-applies it.
    <select className="preset-select" aria-label="Window preset" value="" onChange={(event) => {
      const preset = presets.find((item) => item.name === event.target.value);
      if (preset) setWindow(viewportId, preset.ww, preset.wl);
    }}>
      <option value="">Preset</option>
      {fromFile.length > 0 && <optgroup label="From image">{fromFile.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</optgroup>}
      <optgroup label={modality?.toUpperCase() ?? 'Standard'}>{presetsFor(modality).map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</optgroup>
    </select>
  );
}
