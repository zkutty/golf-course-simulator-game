import { type ReactNode, useEffect } from "react";
import { audioManager } from "./AudioManager";
import { AudioReactContext, type AudioContextValue } from "./audioContext";

export function AudioProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const unlock = () => { void audioManager.unlock(); };
    const uiClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const interactive = event.target.closest("button,[role='tab']");
      if (!interactive || interactive.hasAttribute("disabled")) return;
      void audioManager.playSfx(interactive.getAttribute("role") === "tab" ? "tab" : "button");
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    window.addEventListener("click", uiClick, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("click", uiClick, { capture: true });
    };
  }, []);

  const value: AudioContextValue = {
    unlock: () => audioManager.unlock(),
    setMusicContext: (context) => audioManager.setMusicContext(context),
    setMusicOverride: (context) => audioManager.setMusicOverride(context),
    playSfx: (name, options) => audioManager.playSfx(name, options),
    playSting: (name) => audioManager.playSting(name),
    setAmbientMix: (mix) => audioManager.setAmbientMix(mix),
    setPaused: (paused) => audioManager.setPaused(paused),
    testChannel: (channel) => audioManager.testChannel(channel),
    setVolumes: (volumes) => audioManager.setVolumes(volumes),
    syncVolumes: (volumes) => audioManager.syncVolumes(volumes),
    getVolumes: () => audioManager.getVolumes(),
  };

  return <AudioReactContext.Provider value={value}>{children}</AudioReactContext.Provider>;
}
