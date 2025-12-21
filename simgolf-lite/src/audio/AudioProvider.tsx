import { createContext, useContext, type ReactNode } from "react";
import { audioManager } from "./AudioManager";

interface AudioContextValue {
  unlock: () => Promise<void>;
  setAmbience: (src: string | null) => Promise<void>;
  setMusic: (src: string | null) => Promise<void>;
  playSfx: (src: string) => Promise<void>;
  setVolumes: (volumes: Partial<{ musicVolume: number; ambienceVolume: number; sfxVolume: number }>) => void;
  getVolumes: () => { musicVolume: number; ambienceVolume: number; sfxVolume: number };
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const value: AudioContextValue = {
    unlock: () => audioManager.unlock(),
    setAmbience: (src: string | null) => audioManager.setAmbience(src),
    setMusic: (src: string | null) => audioManager.setMusic(src),
    playSfx: (src: string) => audioManager.playSfx(src),
    setVolumes: (volumes) => audioManager.setVolumes(volumes),
    getVolumes: () => audioManager.getVolumes(),
  };

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioContextValue {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return context;
}
