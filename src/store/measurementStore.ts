import { create } from 'zustand';
import type { Measurement } from '../viewer/measurements/Measurement';

interface MeasurementStore {
  measurements: Measurement[];
  addMeasurement(measurement: Measurement): void;
  undoLast(): void;
  clearForInstance(sopInstanceUID?: string): void;
  clear(): void;
}

export const useMeasurementStore = create<MeasurementStore>((set) => ({
  measurements: [],
  addMeasurement: (measurement) => set((state) => ({ measurements: [...state.measurements, measurement] })),
  undoLast: () => set((state) => ({ measurements: state.measurements.slice(0, -1) })),
  clearForInstance: (sopInstanceUID) => set((state) => ({ measurements: sopInstanceUID ? state.measurements.filter((measurement) => measurement.sopInstanceUID !== sopInstanceUID) : [] })),
  clear: () => set({ measurements: [] })
}));
