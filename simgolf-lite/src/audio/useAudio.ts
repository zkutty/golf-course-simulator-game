import { useEffect, useRef, useState } from "react";

const AUDIO_STORAGE_KEY = "coursecraft_audio_volumes";

interface AudioVolumes {
  music: number;
  ambience: number;
}

const DEFAULT_VOLUMES: AudioVolumes = {
  music: 0.25,
  ambience: 0.40,
};

function loadVolumes(): AudioVolumes {
  try {
    const stored = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        music: typeof parsed.music === "number" ? Math.max(0, Math.min(1, parsed.music)) : DEFAULT_VOLUMES.music,
        ambience: typeof parsed.ambience === "number" ? Math.max(0, Math.min(1, parsed.ambience)) : DEFAULT_VOLUMES.ambience,
      };
    }
  } catch (e) {
    console.warn("Failed to load audio volumes:", e);
  }
  return DEFAULT_VOLUMES;
}

function saveVolumes(volumes: AudioVolumes): void {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(volumes));
  } catch (e) {
    console.warn("Failed to save audio volumes:", e);
  }
}

class AudioPlayer {
  private musicAudio: HTMLAudioElement | null = null;
  private ambienceAudio: HTMLAudioElement | null = null;
  private musicPath: string | null = null;
  private volumes: AudioVolumes = loadVolumes();
  private isEnabled = false;
  private fadeDuration = 650; // ms
  private buttonClickAudio: HTMLAudioElement | null = null;

  constructor() {
    // Create audio elements
    this.ambienceAudio = new Audio();
    this.ambienceAudio.loop = true;
    this.ambienceAudio.preload = "auto";

    this.musicAudio = new Audio();
    this.musicAudio.loop = true;
    this.musicAudio.preload = "auto";

    this.buttonClickAudio = new Audio();
    this.buttonClickAudio.preload = "auto";
    this.buttonClickAudio.src = "/audio/ball-strike.mp3";
    this.buttonClickAudio.volume = 0.6;
    this.buttonClickAudio.onerror = (e) => {
      console.error("[Audio] Button click audio file error:", this.buttonClickAudio?.src, e);
      console.error("[Audio] Error details:", {
        code: this.buttonClickAudio?.error?.code,
        message: this.buttonClickAudio?.error?.message,
      });
    };
    this.buttonClickAudio.onloadeddata = () => {
      console.log("[Audio] Button click audio file loaded, readyState:", this.buttonClickAudio?.readyState);
    };
    this.buttonClickAudio.oncanplaythrough = () => {
      console.log("[Audio] Button click audio can play through");
    };

    // Handle volume changes
    this.updateVolumes();
  }

  setVolumes(volumes: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    saveVolumes(this.volumes);
    this.updateVolumes();
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  private updateVolumes(): void {
    if (this.ambienceAudio) {
      this.ambienceAudio.volume = this.volumes.ambience;
    }
    if (this.musicAudio) {
      this.musicAudio.volume = this.volumes.music;
    }
  }

  async enable(): Promise<void> {
    if (this.isEnabled) {
      console.log("[Audio] Already enabled");
      return;
    }
    console.log("[Audio] Enabling audio context...");
    this.isEnabled = true;

    // Try to play all audio elements to "unlock" audio context
    try {
      if (this.ambienceAudio) {
        this.ambienceAudio.volume = 0;
        try {
          await this.ambienceAudio.play();
          this.ambienceAudio.pause();
        } catch (e) {
          // Ignore - this is just to unlock audio context
        }
        this.ambienceAudio.currentTime = 0;
      }
      if (this.musicAudio) {
        this.musicAudio.volume = 0;
        try {
          await this.musicAudio.play();
          this.musicAudio.pause();
        } catch (e) {
          // Ignore - this is just to unlock audio context
        }
        this.musicAudio.currentTime = 0;
      }
      if (this.buttonClickAudio) {
        this.buttonClickAudio.volume = 0;
        try {
          await this.buttonClickAudio.play();
          this.buttonClickAudio.pause();
        } catch (e) {
          // Ignore - this is just to unlock audio context
        }
        this.buttonClickAudio.currentTime = 0;
        this.buttonClickAudio.volume = 0.6; // Restore button click volume
      }
    } catch (e) {
      console.warn("[Audio] Enable failed:", e);
    }

    this.updateVolumes();
    console.log("[Audio] Audio context enabled, volumes:", this.volumes);
  }

  private async fadeIn(audio: HTMLAudioElement, targetVolume: number): Promise<void> {
    if (!audio || !this.isEnabled) return;

    const startVolume = audio.volume;
    const startTime = Date.now();
    const duration = this.fadeDuration;

    const fade = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      audio.volume = startVolume + (targetVolume - startVolume) * eased;

      if (progress < 1) {
        requestAnimationFrame(fade);
      } else {
        audio.volume = targetVolume;
      }
    };

    fade();
  }

  private async fadeOut(audio: HTMLAudioElement): Promise<void> {
    if (!audio) return;

    const startVolume = audio.volume;
    const startTime = Date.now();
    const duration = this.fadeDuration;

    const fade = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      audio.volume = startVolume * (1 - eased);

      if (progress < 1) {
        requestAnimationFrame(fade);
      } else {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = startVolume;
      }
    };

    fade();
  }

  async setMusic(path: string | null): Promise<void> {
    // Auto-enable if not already enabled
    if (!this.isEnabled) {
      await this.enable();
    }
    if (path === this.musicPath) return;

    const oldMusic = this.musicAudio;
    this.musicPath = path;

    // Fade out old music
    if (oldMusic && !oldMusic.paused) {
      await this.fadeOut(oldMusic);
    }

    // Load and fade in new music
    if (path && this.musicAudio) {
      // Stop ambience when music starts
      await this.setAmbience(false);
      this.musicAudio.src = path;
      this.musicAudio.volume = 0;
      try {
        // Add error handler to detect missing files
        this.musicAudio.onerror = (e) => {
          console.error("[Audio] Music file error:", path, e);
        };
        this.musicAudio.onloadeddata = () => {
          console.log("[Audio] Music file loaded:", path);
        };
        await this.musicAudio.play();
        await this.fadeIn(this.musicAudio, this.volumes.music);
        console.log("[Audio] Music playing:", path);
      } catch (e) {
        console.warn("[Audio] Failed to play music:", path, e);
        // If music fails, start ambience as fallback
        await this.setAmbience(true);
      }
    } else if (this.musicAudio) {
      this.musicAudio.pause();
      this.musicAudio.currentTime = 0;
      // When music stops, start ambience
      await this.setAmbience(true);
    }
  }

  async setAmbience(play: boolean): Promise<void> {
    // Auto-enable if not already enabled
    if (!this.isEnabled) {
      await this.enable();
    }
    if (!this.ambienceAudio) {
      console.warn("[Audio] Ambience audio element not available");
      return;
    }

    if (play && this.ambienceAudio.paused) {
      // Make sure the file is loaded
      if (this.ambienceAudio.readyState < 2) {
        console.log("[Audio] Ambience not ready, waiting...");
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Ambience load timeout"));
          }, 5000);
          const onCanPlay = () => {
            clearTimeout(timeout);
            this.ambienceAudio!.removeEventListener("canplaythrough", onCanPlay);
            this.ambienceAudio!.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            clearTimeout(timeout);
            this.ambienceAudio!.removeEventListener("canplaythrough", onCanPlay);
            this.ambienceAudio!.removeEventListener("error", onError);
            reject(new Error("Ambience load error"));
          };
          this.ambienceAudio!.addEventListener("canplaythrough", onCanPlay);
          this.ambienceAudio!.addEventListener("error", onError);
        }).catch((e) => {
          console.warn("[Audio] Ambience load wait failed:", e);
        });
      }
      
      // Fade in ambience
      this.ambienceAudio.volume = 0;
      try {
        this.ambienceAudio.onerror = (e) => {
          console.error("[Audio] Ambience file error:", this.ambienceAudio?.src, e);
          console.error("[Audio] Error details:", {
            code: this.ambienceAudio?.error?.code,
            message: this.ambienceAudio?.error?.message,
          });
        };
        this.ambienceAudio.onloadeddata = () => {
          console.log("[Audio] Ambience file loaded:", this.ambienceAudio?.src, "readyState:", this.ambienceAudio?.readyState);
        };
        console.log("[Audio] Starting ambience playback, readyState:", this.ambienceAudio.readyState);
        await this.ambienceAudio.play();
        await this.fadeIn(this.ambienceAudio, this.volumes.ambience);
        console.log("[Audio] Ambience playing at volume:", this.volumes.ambience);
      } catch (e) {
        console.warn("[Audio] Failed to play ambience:", e);
      }
    } else if (!play && !this.ambienceAudio.paused) {
      // Fade out ambience
      console.log("[Audio] Fading out ambience");
      await this.fadeOut(this.ambienceAudio);
    }
  }

  setAmbiencePath(path: string): void {
    if (this.ambienceAudio) {
      this.ambienceAudio.src = path;
    }
  }

  async playButtonClick(): Promise<void> {
    if (!this.buttonClickAudio) {
      console.warn("[Audio] Button click audio element not available");
      return;
    }
    
    // Enable audio if not already enabled (allows button clicks to unlock audio)
    if (!this.isEnabled) {
      console.log("[Audio] Enabling audio via button click");
      await this.enable();
    }
    
    // Make sure volume is set (don't rely on initial setting)
    this.buttonClickAudio.volume = 0.6;
    
    // Reset to start and play
    try {
      this.buttonClickAudio.currentTime = 0;
      console.log("[Audio] Playing button click sound, volume:", this.buttonClickAudio.volume);
      await this.buttonClickAudio.play();
      console.log("[Audio] Button click sound playing successfully");
    } catch (e) {
      console.warn("[Audio] Failed to play button click:", e);
      // Try once more after a tiny delay (sometimes helps with browser audio context)
      setTimeout(() => {
        if (this.buttonClickAudio) {
          this.buttonClickAudio.currentTime = 0;
          this.buttonClickAudio.play().catch((err) => {
            console.warn("[Audio] Retry also failed:", err);
          });
        }
      }, 50);
    }
  }

  dispose(): void {
    if (this.musicAudio) {
      this.musicAudio.pause();
      this.musicAudio.src = "";
    }
    if (this.ambienceAudio) {
      this.ambienceAudio.pause();
      this.ambienceAudio.src = "";
    }
    if (this.buttonClickAudio) {
      this.buttonClickAudio.pause();
      this.buttonClickAudio.src = "";
    }
  }
}

export function useAudio(screen: "menu" | "game", audioEnabled: boolean, viewMode: "COZY" | "ARCHITECT" = "COZY") {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  if (!playerRef.current) {
    playerRef.current = new AudioPlayer();
    playerRef.current.setAmbiencePath("/audio/course-ambiance.mp3");
  }

  const player = playerRef.current;

  // Detect autoplay blocking
  useEffect(() => {
    if (!audioEnabled || userInteracted) return;

    const testAudio = new Audio();
    testAudio.volume = 0;
    testAudio
      .play()
      .then(() => {
        testAudio.pause();
        setAutoplayBlocked(false);
      })
      .catch(() => {
        setAutoplayBlocked(true);
      });
  }, [audioEnabled, userInteracted]);

  // Handle user interaction to unlock audio
  useEffect(() => {
    if (userInteracted || !audioEnabled) return;

    const handleInteraction = async () => {
      setUserInteracted(true);
      setAutoplayBlocked(false);
      await player.enable();
    };

    document.addEventListener("click", handleInteraction, { once: true });
    document.addEventListener("keydown", handleInteraction, { once: true });
    document.addEventListener("touchstart", handleInteraction, { once: true });

    return () => {
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
    };
  }, [audioEnabled, userInteracted, player]);

  // Update audio based on screen
  useEffect(() => {
    // If audio is disabled, stop everything
    if (!audioEnabled) {
      player.setMusic(null);
      player.setAmbience(false);
      return;
    }

    // Only play audio if user has interacted (or autoplay is allowed)
    if (!userInteracted && autoplayBlocked) {
      console.log("[Audio] Waiting for user interaction before playing music");
      return;
    }

    console.log(`[Audio] Setting music for screen: ${screen}, viewMode: ${viewMode}, userInteracted: ${userInteracted}`);
    if (screen === "menu") {
      player.setMusic("/audio/menu-theme.mp3").catch((e) => {
        console.error("[Audio] Failed to set menu music:", e);
      });
      // Ambience will be stopped automatically when music starts
    } else if (screen === "game") {
      if (viewMode === "COZY") {
        // COZY mode: ambiance only, no music
        player.setMusic(null);
        player.setAmbience(true).catch((e) => {
          console.error("[Audio] Failed to set ambience:", e);
        });
      } else {
        // ARCHITECT mode: music track
        player.setMusic("/audio/design-loop-1.mp3").catch((e) => {
          console.error("[Audio] Failed to set game music:", e);
        });
        // Ambience will be stopped automatically when music starts
      }
    }
  }, [screen, viewMode, audioEnabled, userInteracted, autoplayBlocked, player]);

  // Cleanup
  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
    };
  }, []);

  const enableAudio = async () => {
    setUserInteracted(true);
    setAutoplayBlocked(false);
    await player.enable();
    // Trigger screen update to start audio
    if (screen === "menu") {
      player.setMusic("/audio/menu-theme.mp3");
    } else if (screen === "game") {
      if (viewMode === "COZY") {
        player.setMusic(null);
        player.setAmbience(true);
      } else {
        player.setMusic("/audio/design-loop-1.mp3");
      }
    }
  };

  return {
    setVolumes: (volumes: Partial<AudioVolumes>) => player.setVolumes(volumes),
    getVolumes: () => player.getVolumes(),
    autoplayBlocked: autoplayBlocked && !userInteracted,
    enableAudio,
    playButtonClick: () => void player.playButtonClick(),
  };
}
