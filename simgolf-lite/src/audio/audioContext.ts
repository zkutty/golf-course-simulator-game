import { createContext, useContext } from "react";
import type { AmbientMix, AudioVolumes, MusicContext, SfxName, StingName } from "./AudioManager";

export interface AudioContextValue {
  unlock: () => Promise<void>;
  setMusicContext: (context: MusicContext) => Promise<void>;
  setMusicOverride: (context: MusicContext | null) => Promise<void>;
  playSfx: (name: SfxName, options?: { volume?: number; force?: boolean }) => Promise<void>;
  playSting: (name: StingName) => Promise<void>;
  setAmbientMix: (mix: AmbientMix) => void;
  setPaused: (paused: boolean) => void;
  testChannel: (channel: "music" | "sfx" | "ambience") => void;
  setVolumes: (volumes: Partial<AudioVolumes>) => void;
  syncVolumes: (volumes: AudioVolumes) => void;
  getVolumes: () => AudioVolumes;
}

export const AudioReactContext = createContext<AudioContextValue | null>(null);

export function useAudio(): AudioContextValue {
  const context = useContext(AudioReactContext);
  if (!context) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return context;
}
