import { createContext, useContext } from "react";

export interface AudioContextValue {
  unlock: () => Promise<void>;
  setAmbience: (src: string | null) => Promise<void>;
  setMusic: (src: string | null) => Promise<void>;
  playSfx: (src: string) => Promise<void>;
  setVolumes: (volumes: Partial<{ musicVolume: number; ambienceVolume: number; sfxVolume: number }>) => void;
  getVolumes: () => { musicVolume: number; ambienceVolume: number; sfxVolume: number };
}

export const AudioReactContext = createContext<AudioContextValue | null>(null);

export function useAudio(): AudioContextValue {
  const context = useContext(AudioReactContext);
  if (!context) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return context;
}
