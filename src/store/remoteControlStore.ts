import { create } from 'zustand';
import type { MprSettings } from '../types/remote';

export const useRemoteControlStore = create<{
  mprRequest?: { settings: MprSettings };
  mprActual?: MprSettings;
}>(() => ({}));
