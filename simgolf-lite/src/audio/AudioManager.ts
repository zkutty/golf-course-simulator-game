const AUDIO_STORAGE_KEY = "coursecraft_audio_volumes";

interface AudioVolumes {
  musicVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
}

const DEFAULT_VOLUMES: AudioVolumes = {
  musicVolume: 0.25,
  ambienceVolume: 0.40,
  sfxVolume: 0.6,
};

function loadVolumes(): AudioVolumes {
  try {
    const stored = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        musicVolume: typeof parsed.musicVolume === "number" ? Math.max(0, Math.min(1, parsed.musicVolume)) : DEFAULT_VOLUMES.musicVolume,
        ambienceVolume: typeof parsed.ambienceVolume === "number" ? Math.max(0, Math.min(1, parsed.ambienceVolume)) : DEFAULT_VOLUMES.ambienceVolume,
        sfxVolume: typeof parsed.sfxVolume === "number" ? Math.max(0, Math.min(1, parsed.sfxVolume)) : DEFAULT_VOLUMES.sfxVolume,
      };
    }
  } catch (e) {
    console.warn("[AudioManager] Failed to load volumes:", e);
  }
  return DEFAULT_VOLUMES;
}

function saveVolumes(volumes: AudioVolumes): void {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(volumes));
  } catch (e) {
    console.warn("[AudioManager] Failed to save volumes:", e);
  }
}

class AudioManager {
  private static instance: AudioManager | null = null;
  private audioUnlocked = false;
  private volumes: AudioVolumes = loadVolumes();
  
  private musicAudio: HTMLAudioElement | null = null;
  private ambienceAudio: HTMLAudioElement | null = null;
  private sfxPool: HTMLAudioElement[] = [];
  private currentAmbienceSrc: string | null = null;
  private currentMusicSrc: string | null = null;
  
  private fadeDuration = 650; // ms
  private readonly MAX_SFX_POOL_SIZE = 5;

  private constructor() {
    this.musicAudio = new Audio();
    this.musicAudio.loop = true;
    this.musicAudio.preload = "auto";
    this.musicAudio.volume = this.volumes.musicVolume;

    this.ambienceAudio = new Audio();
    this.ambienceAudio.loop = true;
    this.ambienceAudio.preload = "auto";
    this.ambienceAudio.volume = this.volumes.ambienceVolume;
  }

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  async unlock(): Promise<void> {
    if (this.audioUnlocked) return;

    console.log("[AudioManager] Unlocking audio context...");
    
    // Try to play/pause a silent sound to unlock audio context
    const testAudio = new Audio();
    testAudio.volume = 0;
    try {
      await testAudio.play();
      testAudio.pause();
      this.audioUnlocked = true;
      console.log("[AudioManager] Audio context unlocked");
    } catch (e) {
      console.warn("[AudioManager] Audio unlock failed:", e);
      // Still mark as unlocked - some browsers allow audio after user gesture even if test fails
      this.audioUnlocked = true;
    }
  }

  setVolumes(volumes: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    saveVolumes(this.volumes);
    
    if (this.musicAudio) this.musicAudio.volume = this.volumes.musicVolume;
    if (this.ambienceAudio) this.ambienceAudio.volume = this.volumes.ambienceVolume;
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  private async fadeIn(audio: HTMLAudioElement, targetVolume: number): Promise<void> {
    if (!audio || !this.audioUnlocked) return;

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

  async setAmbience(src: string | null): Promise<void> {
    if (!this.audioUnlocked) {
      console.warn("[AudioManager] Cannot set ambience: audio not unlocked");
      return;
    }

    if (!this.ambienceAudio) return;

    if (src === null) {
      // Stop ambience
      if (!this.ambienceAudio.paused) {
        await this.fadeOut(this.ambienceAudio);
      }
      this.currentAmbienceSrc = null;
      return;
    }

    if (src === this.currentAmbienceSrc) {
      // Already playing this ambience
      if (this.ambienceAudio.paused) {
        // Resume if paused
        try {
          this.ambienceAudio.volume = 0;
          await this.ambienceAudio.play();
          await this.fadeIn(this.ambienceAudio, this.volumes.ambienceVolume);
        } catch (e) {
          console.warn("[AudioManager] Failed to resume ambience:", e);
        }
      }
      return;
    }

    // Fade out old ambience
    if (!this.ambienceAudio.paused) {
      await this.fadeOut(this.ambienceAudio);
    }

    // Load and play new ambience
    this.currentAmbienceSrc = src;
    this.ambienceAudio.src = src;
    this.ambienceAudio.volume = 0;

    try {
      await this.ambienceAudio.play();
      await this.fadeIn(this.ambienceAudio, this.volumes.ambienceVolume);
      console.log("[AudioManager] Ambience playing:", src);
    } catch (e) {
      console.warn("[AudioManager] Failed to play ambience:", src, e);
    }
  }

  async setMusic(src: string | null): Promise<void> {
    if (!this.audioUnlocked) {
      console.warn("[AudioManager] Cannot set music: audio not unlocked");
      return;
    }

    if (!this.musicAudio) return;

    if (src === null) {
      // Stop music
      if (!this.musicAudio.paused) {
        await this.fadeOut(this.musicAudio);
      }
      this.currentMusicSrc = null;
      return;
    }

    if (src === this.currentMusicSrc) {
      // Already playing this music
      if (this.musicAudio.paused) {
        // Resume if paused
        try {
          this.musicAudio.volume = 0;
          await this.musicAudio.play();
          await this.fadeIn(this.musicAudio, this.volumes.musicVolume);
        } catch (e) {
          console.warn("[AudioManager] Failed to resume music:", e);
        }
      }
      return;
    }

    // Stop ambience when music starts
    await this.setAmbience(null);

    // Fade out old music
    if (!this.musicAudio.paused) {
      await this.fadeOut(this.musicAudio);
    }

    // Load and play new music
    this.currentMusicSrc = src;
    this.musicAudio.src = src;
    this.musicAudio.volume = 0;

    try {
      await this.musicAudio.play();
      await this.fadeIn(this.musicAudio, this.volumes.musicVolume);
      console.log("[AudioManager] Music playing:", src);
    } catch (e) {
      console.warn("[AudioManager] Failed to play music:", src, e);
    }
  }

  async playSfx(src: string): Promise<void> {
    if (!this.audioUnlocked) {
      console.warn("[AudioManager] Cannot play SFX: audio not unlocked");
      return;
    }

    // Get an available audio element from the pool
    let audio: HTMLAudioElement | null = null;
    
    // Find an available (paused) element in the pool
    for (const a of this.sfxPool) {
      if (a.paused || a.ended) {
        audio = a;
        break;
      }
    }

    // If no available element and pool not full, create a new one
    if (!audio && this.sfxPool.length < this.MAX_SFX_POOL_SIZE) {
      audio = new Audio();
      audio.preload = "auto";
      this.sfxPool.push(audio);
    }

    // If still no available element, reuse the first one (force interrupt)
    if (!audio && this.sfxPool.length > 0) {
      audio = this.sfxPool[0];
    }

    if (!audio) {
      // Create a temporary one if pool is somehow empty
      audio = new Audio();
      audio.preload = "auto";
    }

    audio.src = src;
    audio.volume = this.volumes.sfxVolume;
    audio.currentTime = 0;

    try {
      await audio.play();
      console.log("[AudioManager] SFX playing:", src);
    } catch (e) {
      console.warn("[AudioManager] Failed to play SFX:", src, e);
    }
  }
}

export const audioManager = AudioManager.getInstance();
