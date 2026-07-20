import { audioManager } from "../audio/AudioManager";

/**
 * Compatibility facade for older editor call sites. Playback remains routed
 * through AudioManager's SFX bus, so master/channel mute cannot be bypassed.
 */
export function createSoundPlayer() {
  return {
    playBrush: async (enabled: boolean) => {
      if (enabled) await audioManager.playSfx("brush");
    },
    playConfirm: async (enabled: boolean) => {
      if (enabled) await audioManager.playSfx("confirm");
    },
    playCashTick: async (enabled: boolean) => {
      if (enabled) await audioManager.playSfx("cash");
    },
  };
}
