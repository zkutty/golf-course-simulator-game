import { type ReactNode } from "react";
import { audioManager } from "./AudioManager";
import { AudioReactContext, type AudioContextValue } from "./audioContext";

export function AudioProvider({ children }: { children: ReactNode }) {
  const value: AudioContextValue = {
    unlock: () => audioManager.unlock(),
    setAmbience: (src: string | null) => audioManager.setAmbience(src),
    setMusic: (src: string | null) => audioManager.setMusic(src),
    playSfx: (src: string) => audioManager.playSfx(src),
    setVolumes: (volumes) => audioManager.setVolumes(volumes),
    syncVolumes: (volumes) => audioManager.syncVolumes(volumes),
    getVolumes: () => audioManager.getVolumes(),
  };

  return <AudioReactContext.Provider value={value}>{children}</AudioReactContext.Provider>;
}
