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
    if (this.isEnabled) return;
    this.isEnabled = true;

    // Try to play both to "unlock" audio context
    try {
      if (this.ambienceAudio) {
        this.ambienceAudio.volume = 0;
        await this.ambienceAudio.play().catch(() => {});
        this.ambienceAudio.pause();
        this.ambienceAudio.currentTime = 0;
      }
      if (this.musicAudio) {
        this.musicAudio.volume = 0;
        await this.musicAudio.play().catch(() => {});
        this.musicAudio.pause();
        this.musicAudio.currentTime = 0;
      }
    } catch (e) {
      console.warn("Audio enable failed:", e);
    }

    this.updateVolumes();
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
    if (!this.isEnabled) return;
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
        await this.musicAudio.play();
        await this.fadeIn(this.musicAudio, this.volumes.music);
      } catch (e) {
        console.warn("Failed to play music:", e);
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
    if (!this.isEnabled) return;
    if (!this.ambienceAudio) return;

    if (play && this.ambienceAudio.paused) {
      // Fade in ambience
      this.ambienceAudio.volume = 0;
      try {
        await this.ambienceAudio.play();
        await this.fadeIn(this.ambienceAudio, this.volumes.ambience);
      } catch (e) {
        console.warn("Failed to play ambience:", e);
      }
    } else if (!play && !this.ambienceAudio.paused) {
      // Fade out ambience
      await this.fadeOut(this.ambienceAudio);
    }
  }

  setAmbiencePath(path: string): void {
    if (this.ambienceAudio) {
      this.ambienceAudio.src = path;
    }
  }

  playButtonClick(): void {
    if (!this.isEnabled || !this.buttonClickAudio) return;
    // Reset to start and play
    this.buttonClickAudio.currentTime = 0;
    this.buttonClickAudio.play().catch((e) => {
      console.warn("Failed to play button click:", e);
    });
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

export function useAudio(screen: "menu" | "game", audioEnabled: boolean) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  if (!playerRef.current) {
    playerRef.current = new AudioPlayer();
    playerRef.current.setAmbiencePath("/audio/course-ambiance.wav");
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
    if (!userInteracted && autoplayBlocked) return;

    if (screen === "menu") {
      player.setMusic("/audio/menu-theme.mp3");
      // Ambience will be stopped automatically when music starts
    } else if (screen === "game") {
      player.setMusic("/audio/design-loop.mp3");
      // Ambience will be stopped automatically when music starts
    }
  }, [screen, audioEnabled, userInteracted, autoplayBlocked, player]);

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
      player.setMusic("/audio/design-loop.mp3");
    }
  };

  return {
    setVolumes: (volumes: Partial<AudioVolumes>) => player.setVolumes(volumes),
    getVolumes: () => player.getVolumes(),
    autoplayBlocked: autoplayBlocked && !userInteracted,
    enableAudio,
    playButtonClick: () => player.playButtonClick(),
  };
}
