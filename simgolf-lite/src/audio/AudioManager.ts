import { loadAppProfile, updateProfileTab } from "../game/onboarding/profile";
import {
  SUNO_AMBIENCE_PLAYLISTS,
  SUNO_MUSIC_PLAYLISTS,
  type SunoAmbienceContext,
  type SunoAudioAsset,
  type SunoMusicContext,
} from "./sunoLibrary";
import type { SeasonName, WeatherKind } from "../game/seasons/types";
import {
  hasWeatherPriority,
  type ProceduralAmbienceFamily,
} from "./seasonalAmbience";

export interface AudioVolumes {
  masterVolume: number;
  musicVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
  masterMuted: boolean;
  muteWhenHidden: boolean;
}

export type MusicContext = "silent" | SunoMusicContext;
export type AudioSurface = "menu" | "vision" | "setup" | "game" | "loading";
export type StingName = "celebration" | "record" | "achievement";
export type SfxName =
  | "brush" | "confirm" | "cash" | "button" | "tab" | "error" | "sculpt"
  | "driver" | "iron" | "chip" | "putt"
  | "land-fairway" | "land-green" | "land-sand" | "land-water"
  | "land-rough" | "tree" | "cup" | "crowd-cheer" | "crowd-groan";

export interface AmbientMix {
  enabled: boolean;
  season: SeasonName;
  weatherKind: WeatherKind;
  birds: number;
  water: number;
  wind: number;
  murmur: number;
  crickets: number;
  rain: number;
  bed: SunoAmbienceContext;
  paused: boolean;
}

export interface AudioDebugSnapshot {
  unlocked: boolean;
  contextState: AudioContextState | "unavailable";
  surface: AudioSurface;
  hidden: boolean;
  masterMuted: boolean;
  muteWhenHidden: boolean;
  worldAmbienceAllowed: boolean;
  authoredAmbienceAllowed: boolean;
  authoredNatureOwner: boolean;
  authoredFallback: boolean;
  authoredFallbackBed: SunoAmbienceContext | null;
  authoredAttempts: {
    total: number;
    inFlightBeds: SunoAmbienceContext[];
    current: {
      bed: SunoAmbienceContext;
      generation: number;
    } | null;
  };
  authoredMedia: {
    trackId: string | null;
    volume: number;
    paused: boolean;
    currentTime: number;
  } | null;
  mediaSlots: {
    music: Array<{
      trackId: string | null;
      volume: number;
      paused: boolean;
    }>;
    ambience: Array<{
      trackId: string | null;
      volume: number;
      paused: boolean;
    }>;
  };
  resolvedMusicContext: MusicContext;
  playingMusicContext: MusicContext;
  playingAmbience: SunoAmbienceContext | null;
  priority: "weather" | "score" | "season";
  effectiveAmbienceBus: number;
  actualAmbienceBusGain: number;
  proceduralSourceCount: number;
  proceduralRampVersion: number;
  proceduralSourceCounts: Record<ProceduralAmbienceFamily, number>;
  proceduralTargets: Record<ProceduralAmbienceFamily, number>;
  proceduralActuals: Record<ProceduralAmbienceFamily, number>;
  desiredActiveProceduralFamilies: ProceduralAmbienceFamily[];
  actualActiveProceduralFamilies: ProceduralAmbienceFamily[];
  transition: {
    version: number;
    fromSeason: SeasonName;
    toSeason: SeasonName;
    fromWeather: WeatherKind;
    toWeather: WeatherKind;
    durationMs: number;
  };
}

export const MUSIC_PLAYLISTS: Record<SunoMusicContext, readonly SunoAudioAsset[]> = SUNO_MUSIC_PLAYLISTS;
export const AMBIENCE_PLAYLISTS: Record<SunoAmbienceContext, readonly SunoAudioAsset[]> = SUNO_AMBIENCE_PLAYLISTS;

function loadVolumes(): AudioVolumes {
  return { ...loadAppProfile().audio };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

const PROCEDURAL_FAMILIES: readonly ProceduralAmbienceFamily[] = [
  "birds",
  "water",
  "wind",
  "murmur",
  "crickets",
  "rain",
];

const SYNCHRONOUS_FADE_START_RATIO = 0.1;

class AudioManager {
  private static instance: AudioManager | null = null;
  private unlocked = false;
  private volumes: AudioVolumes = loadVolumes();
  private hidden = typeof document !== "undefined" && document.hidden;
  private surface: AudioSurface = "loading";
  private unlockPromise: Promise<void> | null = null;
  private paused = false;
  private pauseDuck = 1;
  private stingDuck = 1;
  private context: MusicContext = "silent";
  private playingContext: MusicContext = "silent";
  private override: MusicContext | null = null;
  private trackIndex = new Map<MusicContext, number>();
  private contextPositions = new Map<MusicContext, number>();
  private musicSlots: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private activeSlot = 0;
  private musicSwitchVersion = 0;
  private musicPlayClaims = new WeakMap<HTMLAudioElement, number>();
  private musicSwitchTarget: MusicContext | null = null;
  private musicSwitchPromise: Promise<void> | null = null;
  private ambienceSlots: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private activeAmbienceSlot = 0;
  private ambienceSwitchVersion = 0;
  private ambiencePlayClaims = new WeakMap<HTMLAudioElement, number>();
  private playingAmbience: SunoAmbienceContext | null = null;
  private ambienceTrackIndex = new Map<SunoAmbienceContext, number>();
  private currentAmbienceRequest: {
    bed: SunoAmbienceContext;
    generation: number;
    promise: Promise<void>;
  } | null = null;
  private ambienceInFlight = new Map<number, SunoAmbienceContext>();
  private ambienceAttemptCounts = new Map<SunoAmbienceContext, number>();
  private fadeVersions = new WeakMap<HTMLAudioElement, number>();
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private ambienceLayers = new Map<ProceduralAmbienceFamily, GainNode>();
  private ambienceSources: AudioBufferSourceNode[] = [];
  private proceduralSourceCounts = new Map<ProceduralAmbienceFamily, number>();
  private proceduralTargets = new Map<ProceduralAmbienceFamily, number>();
  private proceduralMixKey = "";
  private proceduralRampVersion = 0;
  private authoredAmbienceFallback = false;
  private authoredAmbienceFallbackBed: SunoAmbienceContext | null = null;
  private transitionVersion = 0;
  private lastTransition = {
    fromSeason: "summer" as SeasonName,
    toSeason: "summer" as SeasonName,
    fromWeather: "clear" as WeatherKind,
    toWeather: "clear" as WeatherKind,
    durationMs: 0,
  };
  private ambientMix: AmbientMix = {
    enabled: false,
    season: "summer",
    weatherKind: "clear",
    birds: 0,
    water: 0,
    wind: 0,
    murmur: 0,
    crickets: 0,
    rain: 0,
    bed: "parkland",
    paused: true,
  };
  private voices = new Set<AudioScheduledSourceNode>();
  private lastPlayed = new Map<SfxName, number>();
  private readonly MAX_VOICES = 8;

  private constructor() {
    if (typeof Audio !== "undefined") {
      this.musicSlots = [this.createMusicElement(), this.createMusicElement()];
      this.ambienceSlots = [this.createAmbienceElement(), this.createAmbienceElement()];
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        this.hidden = document.hidden;
        this.rampAll(0.35);
      });
    }
  }

  static getInstance(): AudioManager {
    AudioManager.instance ??= new AudioManager();
    return AudioManager.instance;
  }

  private createMusicElement(): HTMLAudioElement {
    const audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => {
      if (audio === this.musicSlots?.[this.activeSlot]) void this.advanceTrack();
    });
    return audio;
  }

  private createAmbienceElement(): HTMLAudioElement {
    const audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => {
      if (audio === this.ambienceSlots?.[this.activeAmbienceSlot]) void this.advanceAmbienceTrack();
    });
    return audio;
  }

  private effective(channel: "musicVolume" | "ambienceVolume" | "sfxVolume"): number {
    if (this.volumes.masterMuted || (this.hidden && this.volumes.muteWhenHidden)) return 0;
    const duck = channel === "musicVolume" ? this.pauseDuck * this.stingDuck : 1;
    return clamp01(this.volumes.masterVolume * this.volumes[channel] * duck);
  }

  private worldAmbienceAllowed(): boolean {
    return this.surface === "game" && this.ambientMix.enabled;
  }

  private authoredAmbienceAllowed(): boolean {
    return this.worldAmbienceAllowed() && this.resolvedContext() === "silent";
  }

  private authoredNatureOwner(): boolean {
    const active = this.ambienceSlots?.[this.activeAmbienceSlot];
    return this.authoredAmbienceAllowed()
      && this.playingAmbience != null
      && active != null
      && !active.paused;
  }

  private priority(): AudioDebugSnapshot["priority"] {
    const context = this.resolvedContext();
    if (context === "tension" || context.startsWith("tournament-")) return "score";
    if (hasWeatherPriority(this.ambientMix.weatherKind)) return "weather";
    return "season";
  }

  private ambientSampleLevel(): number {
    if (!this.authoredAmbienceAllowed()) return 0;
    const activity = Math.max(
      this.ambientMix.birds,
      this.ambientMix.water,
      this.ambientMix.wind,
      this.ambientMix.murmur,
      this.ambientMix.crickets,
      this.ambientMix.rain,
      0.28,
    );
    return this.effective("ambienceVolume") * (this.ambientMix.paused ? 0.12 : 0.58 + activity * 0.22);
  }

  private rampParam(param: AudioParam, value: number, seconds = 0.08): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(clamp01(value), t + seconds);
  }

  private rampAll(seconds = 0.08): void {
    const musicEnabled = this.resolvedContext() !== "silent";
    const music = musicEnabled ? this.effective("musicVolume") : 0;
    this.musicSlots?.forEach((slot, index) => {
      const active = musicEnabled && index === this.activeSlot;
      this.fadeElement(slot, active ? music : 0, seconds * 1000, !active);
    });
    const ambience = this.ambientSampleLevel();
    this.ambienceSlots?.forEach((slot, index) => {
      const active = this.authoredAmbienceAllowed() && index === this.activeAmbienceSlot;
      this.fadeElement(slot, active ? ambience : 0, seconds * 1000, !active);
    });
    if (this.sfxBus) this.rampParam(this.sfxBus.gain, this.effective("sfxVolume"), seconds);
    if (this.ambienceBus) {
      this.rampParam(
        this.ambienceBus.gain,
        this.worldAmbienceAllowed() ? this.effective("ambienceVolume") : 0,
        seconds,
      );
    }
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    if (this.unlockPromise) return this.unlockPromise;
    this.unlockPromise = this.initializeUnlock();
    try {
      await this.unlockPromise;
    } finally {
      this.unlockPromise = null;
    }
  }

  private async initializeUnlock(): Promise<void> {
    const Context = typeof window === "undefined" ? undefined : window.AudioContext;
    if (Context) {
      this.ctx = new Context();
      this.sfxBus = this.ctx.createGain();
      this.ambienceBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.effective("sfxVolume");
      this.ambienceBus.gain.value = this.worldAmbienceAllowed() ? this.effective("ambienceVolume") : 0;
      this.sfxBus.connect(this.ctx.destination);
      this.ambienceBus.connect(this.ctx.destination);
      await this.ctx.resume().catch(() => undefined);
      this.createAmbientBed();
      this.rampProceduralAmbience(0);
    }
    this.unlocked = true;
    if (this.resolvedContext() !== "silent") await this.requestPlaylist(this.resolvedContext());
    if (this.authoredAmbienceAllowed()) await this.requestAmbience(this.ambientMix.bed);
  }

  setSurface(surface: AudioSurface): void {
    if (surface === this.surface) return;
    const wasAuthoredAllowed = this.authoredAmbienceAllowed();
    this.surface = surface;
    if (!this.worldAmbienceAllowed()) this.stopAmbience();
    else if (!wasAuthoredAllowed && this.authoredAmbienceAllowed() && this.unlocked) {
      void this.requestAmbience(this.ambientMix.bed);
    }
    if (this.ctx) this.rampProceduralAmbience();
  }

  setVolumes(volumes: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    updateProfileTab("audio", this.volumes);
    if (volumes.masterMuted === true) this.applyImmediateMute();
    else this.rampAll();
  }

  syncVolumes(volumes: AudioVolumes): void {
    this.volumes = { ...volumes };
    if (volumes.masterMuted) this.applyImmediateMute();
    else this.rampAll();
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.pauseDuck = paused ? 0.45 : 1;
    this.rampAll(0.25);
  }

  setMusicContext(context: MusicContext): Promise<void> {
    const previous = this.resolvedContext();
    this.context = context;
    const next = this.resolvedContext();
    if (this.ctx) this.rampProceduralAmbience(0.65);
    if (next === previous && this.playingContext === next) return Promise.resolve();
    return this.requestPlaylist(next);
  }

  setMusicOverride(context: MusicContext | null): Promise<void> {
    const previous = this.resolvedContext();
    this.override = context;
    const next = this.resolvedContext();
    if (this.ctx) this.rampProceduralAmbience(0.65);
    if (next === previous && this.playingContext === next) return Promise.resolve();
    return this.requestPlaylist(next);
  }

  private requestPlaylist(context: MusicContext): Promise<void> {
    if (this.musicSwitchTarget === context && this.musicSwitchPromise) return this.musicSwitchPromise;
    this.musicSwitchTarget = context;
    const promise = this.switchPlaylist(context);
    this.musicSwitchPromise = promise;
    void promise.then(
      () => {
        if (this.musicSwitchPromise === promise) {
          this.musicSwitchPromise = null;
          this.musicSwitchTarget = null;
        }
      },
      () => {
        if (this.musicSwitchPromise === promise) {
          this.musicSwitchPromise = null;
          this.musicSwitchTarget = null;
        }
      },
    );
    return promise;
  }

  private resolvedContext(): MusicContext {
    return this.override ?? this.context;
  }

  private stopElement(audio: HTMLAudioElement): void {
    this.fadeVersions.set(audio, (this.fadeVersions.get(audio) ?? 0) + 1);
    audio.volume = 0;
    audio.pause();
  }

  private stopMusicSlots(): void {
    this.musicSlots?.forEach((slot) => this.stopElement(slot));
  }

  private async switchPlaylist(context: MusicContext): Promise<void> {
    if (!this.unlocked || !this.musicSlots) return;
    const switchVersion = ++this.musicSwitchVersion;
    const old = this.musicSlots[this.activeSlot];
    if (this.playingContext !== "silent" && old.currentTime > 0 && !old.ended) this.contextPositions.set(this.playingContext, old.currentTime);
    if (context === "silent") {
      this.playingContext = "silent";
      this.stopMusicSlots();
      if (this.authoredAmbienceAllowed()) await this.requestAmbience(this.ambientMix.bed);
      return;
    }
    // CourseCraft owns one file-backed background recording at a time.
    // Stop authored ambience and the outgoing score before starting the next
    // context so route/tutorial transitions cannot sound like layered songs.
    this.stopAmbience();
    const list = MUSIC_PLAYLISTS[context];
    const index = this.trackIndex.get(context) ?? 0;
    const selected = list[index % list.length];
    const src = selected.src;
    if (old.dataset.trackId === selected.id && !old.paused) {
      this.musicSlots.forEach((slot, slotIndex) => {
        if (slotIndex !== this.activeSlot) this.stopElement(slot);
      });
      this.playingContext = context;
      this.fadeElement(old, this.effective("musicVolume"), 120, false);
      return;
    }
    this.stopMusicSlots();
    const nextSlot = this.activeSlot === 0 ? 1 : 0;
    const next = this.musicSlots[nextSlot];
    next.src = src;
    next.dataset.trackId = selected.id;
    next.currentTime = this.contextPositions.get(context) ?? 0;
    next.volume = 0;
    // Reused slots are created with preload=none. Explicitly restart resource
    // selection when a slot receives a new source; otherwise Chromium can keep
    // the recycled element in NETWORK_NO_SOURCE and resolve play() without
    // ever advancing the track.
    next.load();
    this.musicPlayClaims.set(next, switchVersion);
    const targetVolume = this.establishFadeStart(next, this.effective("musicVolume"));
    try {
      await next.play();
    } catch {
      if (this.musicPlayClaims.get(next) === switchVersion) this.stopElement(next);
      return;
    }
    if (switchVersion !== this.musicSwitchVersion) {
      if (this.musicPlayClaims.get(next) === switchVersion) {
        next.volume = 0;
        next.pause();
      }
      return;
    }
    this.activeSlot = nextSlot;
    this.playingContext = context;
    this.fadeElement(next, targetVolume, 350, false);
  }

  private establishFadeStart(audio: HTMLAudioElement, target: number): number {
    const clampedTarget = clamp01(target);
    // Set gain after exclusive ownership is established but before play().
    // Hosted Chromium can advance media while its play promise is still
    // pending, so waiting for resolution would leave that stream silent.
    if (audio.volume === 0 && clampedTarget > 0) {
      audio.volume = clampedTarget * SYNCHRONOUS_FADE_START_RATIO;
    }
    return clampedTarget;
  }

  private fadeElement(
    audio: HTMLAudioElement,
    target: number,
    durationMs: number,
    pauseAtEnd: boolean,
  ): void {
    const version = (this.fadeVersions.get(audio) ?? 0) + 1;
    this.fadeVersions.set(audio, version);
    const clampedTarget = pauseAtEnd ? clamp01(target) : this.establishFadeStart(audio, target);
    const from = audio.volume;
    const start = nowMs();
    const tick = () => {
      if (this.fadeVersions.get(audio) !== version) return;
      const p = Math.min(1, (nowMs() - start) / Math.max(1, durationMs));
      audio.volume = clamp01(from + (clampedTarget - from) * (p * p * (3 - 2 * p)));
      if (p < 1) requestAnimationFrame(tick);
      else if (pauseAtEnd) audio.pause();
    };
    requestAnimationFrame(tick);
  }

  private async advanceTrack(): Promise<void> {
    const context = this.resolvedContext();
    if (context === "silent") return;
    const list = MUSIC_PLAYLISTS[context];
    const current = this.trackIndex.get(context) ?? 0;
    const offset = list.length > 1 ? 1 + Math.floor(Math.random() * (list.length - 1)) : 0;
    this.trackIndex.set(context, (current + offset) % list.length);
    this.contextPositions.delete(context);
    await this.requestPlaylist(context);
  }

  private requestAmbience(bed: SunoAmbienceContext): Promise<void> {
    const existing = this.currentAmbienceRequest;
    if (existing?.bed === bed && existing.generation === this.ambienceSwitchVersion) return existing.promise;
    const generation = ++this.ambienceSwitchVersion;
    const promise = this.switchAmbience(bed, generation);
    this.currentAmbienceRequest = { bed, generation, promise };
    this.ambienceInFlight.set(generation, bed);
    void promise.finally(() => {
      this.ambienceInFlight.delete(generation);
      if (this.currentAmbienceRequest?.generation === generation) this.currentAmbienceRequest = null;
    });
    return promise;
  }

  private async switchAmbience(bed: SunoAmbienceContext, generation: number): Promise<void> {
    if (!this.unlocked || !this.ambienceSlots) return;
    if (!this.authoredAmbienceAllowed()) {
      this.stopAmbience();
      return;
    }
    this.ambienceAttemptCounts.set(bed, (this.ambienceAttemptCounts.get(bed) ?? 0) + 1);
    const old = this.ambienceSlots[this.activeAmbienceSlot];
    const list = AMBIENCE_PLAYLISTS[bed];
    const index = this.ambienceTrackIndex.get(bed) ?? 0;
    const selected = list[index % list.length];
    if (this.playingAmbience === bed && old.dataset.trackId === selected.id && !old.paused) {
      this.ambienceSlots.forEach((slot, slotIndex) => {
        if (slotIndex !== this.activeAmbienceSlot) this.stopElement(slot);
      });
      this.rampActiveAmbience(0.5);
      return;
    }
    this.ambienceSlots.forEach((slot) => this.stopElement(slot));
    this.playingAmbience = null;
    const nextSlot = this.activeAmbienceSlot === 0 ? 1 : 0;
    const next = this.ambienceSlots[nextSlot];
    next.src = selected.src;
    next.dataset.trackId = selected.id;
    next.currentTime = 0;
    next.volume = 0;
    next.load();
    this.ambiencePlayClaims.set(next, generation);
    try {
      await next.play();
    } catch {
      if (
        generation === this.ambienceSwitchVersion
        && this.currentAmbienceRequest?.generation === generation
        && this.currentAmbienceRequest.bed === bed
        && this.ambientMix.bed === bed
        && this.authoredAmbienceAllowed()
      ) {
        this.authoredAmbienceFallback = true;
        this.authoredAmbienceFallbackBed = bed;
        this.rampProceduralAmbience(0.35);
      }
      return;
    }
    if (
      generation !== this.ambienceSwitchVersion
      || this.currentAmbienceRequest?.generation !== generation
      || this.currentAmbienceRequest.bed !== bed
      || this.ambientMix.bed !== bed
      || !this.authoredAmbienceAllowed()
    ) {
      if (this.ambiencePlayClaims.get(next) === generation) {
        next.volume = 0;
        next.pause();
      }
      return;
    }
    this.activeAmbienceSlot = nextSlot;
    this.playingAmbience = bed;
    this.authoredAmbienceFallback = false;
    this.authoredAmbienceFallbackBed = null;
    // Successful media play is the handoff point. The incoming file starts at
    // zero while the current procedural nature gains ramp down over the same
    // bounded interval; loading and failed attempts never suppress fallback.
    this.rampProceduralAmbience(0.35);
    this.fadeElement(next, this.ambientSampleLevel(), 350, false);
  }

  private stopAmbience(): void {
    this.ambienceSwitchVersion += 1;
    this.currentAmbienceRequest = null;
    this.playingAmbience = null;
    this.authoredAmbienceFallback = false;
    this.authoredAmbienceFallbackBed = null;
    this.ambienceSlots?.forEach((slot) => this.stopElement(slot));
  }

  private rampActiveAmbience(seconds = 0.8): void {
    if (!this.authoredAmbienceAllowed() || this.playingAmbience == null) return;
    const active = this.ambienceSlots?.[this.activeAmbienceSlot];
    if (active) this.fadeElement(active, this.ambientSampleLevel(), seconds * 1000, false);
    if (this.ambienceBus) {
      this.rampParam(this.ambienceBus.gain, this.effective("ambienceVolume"), seconds);
    }
  }

  private async advanceAmbienceTrack(): Promise<void> {
    if (!this.authoredAmbienceAllowed()) return;
    const bed = this.ambientMix.bed;
    const list = AMBIENCE_PLAYLISTS[bed];
    const current = this.ambienceTrackIndex.get(bed) ?? 0;
    const offset = list.length > 1 ? 1 + Math.floor(Math.random() * (list.length - 1)) : 0;
    this.ambienceTrackIndex.set(bed, (current + offset) % list.length);
    this.playingAmbience = null;
    this.rampProceduralAmbience(0.35);
    await this.requestAmbience(bed);
  }

  async playSting(name: StingName): Promise<void> {
    if (!this.unlocked) return;
    this.stingDuck = 0.28;
    this.rampAll(0.12);
    await this.playSfx(name === "celebration" ? "crowd-cheer" : "confirm", { force: true });
    globalThis.setTimeout(() => {
      this.stingDuck = 1;
      this.rampAll(0.55);
    }, name === "celebration" ? 1300 : 850);
  }

  async playSfx(name: SfxName, options: { volume?: number; force?: boolean } = {}): Promise<void> {
    if (!this.unlocked || !this.ctx || !this.sfxBus || this.effective("sfxVolume") <= 0) return;
    const gap = name.startsWith("land-") ? 55 : name === "brush" ? 35 : 90;
    const time = nowMs();
    if (!options.force && time - (this.lastPlayed.get(name) ?? -Infinity) < gap) return;
    if (!options.force && this.voices.size >= this.MAX_VOICES) return;
    this.lastPlayed.set(name, time);
    this.synthesize(name, clamp01(options.volume ?? 1));
  }

  private register(source: AudioScheduledSourceNode): void {
    this.voices.add(source);
    source.addEventListener("ended", () => this.voices.delete(source), { once: true });
  }

  private synthesize(name: SfxName, level: number): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const t = ctx.currentTime;
    const pitch = 0.95 + Math.random() * 0.1;
    const noiseNames: SfxName[] = ["brush", "sculpt", "driver", "iron", "chip", "land-fairway", "land-green", "land-sand", "land-water", "land-rough", "tree", "crowd-cheer", "crowd-groan"];
    if (noiseNames.includes(name)) {
      const duration = name.startsWith("crowd") ? 0.65 : name === "land-water" ? 0.42 : 0.18;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = pitch;
      const filter = ctx.createBiquadFilter();
      filter.type = name === "land-water" || name.startsWith("crowd") ? "lowpass" : "bandpass";
      filter.frequency.value = name === "land-sand" ? 900 : name === "tree" ? 420 : name.startsWith("crowd") ? 620 : 1450;
      const gain = ctx.createGain();
      const peak = level * (name === "driver" ? 0.42 : name.startsWith("crowd") ? 0.18 : 0.25);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter).connect(gain).connect(bus);
      this.register(source);
      source.start(t);
      source.stop(t + duration);
      if (!["driver", "iron", "chip", "tree"].includes(name)) return;
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const definitions: Partial<Record<SfxName, [OscillatorType, number, number, number]>> = {
      confirm: ["sine", 523, 784, .42], button: ["sine", 440, 590, .12], tab: ["triangle", 620, 760, .1],
      cash: ["triangle", 880, 1320, .22], error: ["square", 150, 95, .2], putt: ["sine", 620, 390, .1],
      cup: ["triangle", 1450, 760, .35], driver: ["triangle", 180, 78, .16], iron: ["triangle", 320, 120, .13],
      chip: ["triangle", 480, 210, .11], tree: ["triangle", 250, 110, .14],
    };
    const [type, from, to, duration] = definitions[name] ?? ["sine", 440, 660, .16];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from * pitch, t);
    oscillator.frequency.exponentialRampToValueAtTime(to * pitch, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level * 0.16, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    oscillator.connect(gain).connect(bus);
    this.register(oscillator);
    oscillator.start(t);
    oscillator.stop(t + duration);
  }

  private createAmbientBed(): void {
    const ctx = this.ctx;
    const bus = this.ambienceBus;
    if (!ctx || !bus || this.ambienceSources.length) return;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * .035) * .995;
      data[i] = brown;
    }
    const configs: Array<[ProceduralAmbienceFamily, BiquadFilterType, number]> = [
      ["birds", "highpass", 1900], ["water", "bandpass", 760], ["wind", "lowpass", 520],
      ["murmur", "bandpass", 340], ["crickets", "highpass", 3100], ["rain", "highpass", 1100],
    ];
    for (const [name, type, frequency] of configs) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = name === "water" ? .72 : name === "birds" ? 1.7 : name === "rain" ? 1.16 : 1;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(bus);
      source.start();
      this.ambienceSources.push(source);
      this.ambienceLayers.set(name, gain);
      this.proceduralSourceCounts.set(name, (this.proceduralSourceCounts.get(name) ?? 0) + 1);
    }
  }

  setAmbientMix(mix: AmbientMix): void {
    const bedChanged = mix.bed !== this.ambientMix.bed;
    const seasonChanged = mix.season !== this.ambientMix.season;
    const weatherChanged = mix.weatherKind !== this.ambientMix.weatherKind;
    const wasEnabled = this.ambientMix.enabled;
    const previousSeason = this.ambientMix.season;
    const previousWeather = this.ambientMix.weatherKind;
    const durationSeconds = mix.paused
      ? 0.25
      : seasonChanged
        ? 1.6
        : weatherChanged
          ? 0.65
          : bedChanged
            ? 0.8
            : 1;
    this.ambientMix = { ...mix };
    if (seasonChanged || weatherChanged) {
      this.transitionVersion += 1;
      this.lastTransition = {
        fromSeason: previousSeason,
        toSeason: mix.season,
        fromWeather: previousWeather,
        toWeather: mix.weatherKind,
        durationMs: durationSeconds * 1000,
      };
    }
    if (this.unlocked) {
      if (!this.authoredAmbienceAllowed()) this.stopAmbience();
      else if (
        !wasEnabled
        || bedChanged
        || (this.playingAmbience == null && !this.authoredAmbienceFallback)
      ) {
        void this.requestAmbience(mix.bed);
      }
      else this.rampActiveAmbience();
    }
    if (!this.ctx) return;
    this.rampProceduralAmbience(durationSeconds);
  }

  private rampProceduralAmbience(seconds = 1): void {
    // Gameplay owns world ambience. Menu, Vision, setup, and loading surfaces
    // are Suno music/SFX-only and must never leak course audio across a route.
    const key = [
      this.surface,
      this.resolvedContext(),
      this.ambientMix.enabled,
      this.ambientMix.paused,
      this.ambientMix.season,
      this.ambientMix.weatherKind,
      this.ambientMix.birds,
      this.ambientMix.water,
      this.ambientMix.wind,
      this.ambientMix.murmur,
      this.ambientMix.crickets,
      this.ambientMix.rain,
      this.authoredNatureOwner(),
    ].join("|");
    if (key === this.proceduralMixKey) return;
    this.proceduralMixKey = key;
    this.proceduralRampVersion += 1;
    const baseScale = !this.worldAmbienceAllowed() ? 0 : this.ambientMix.paused ? 0.025 : 0.22;
    const priority = this.priority();
    for (const name of PROCEDURAL_FAMILIES) {
      const gain = this.ambienceLayers.get(name);
      const natureFamily = name !== "murmur";
      const authoredOwned = natureFamily && this.authoredNatureOwner();
      const weatherSignal = priority === "score"
        && hasWeatherPriority(this.ambientMix.weatherKind)
        && (name === "rain" || name === "wind");
      const priorityScale = priority === "score" && baseScale > 0 && !this.ambientMix.paused
        ? (weatherSignal ? 0.14 : 0.05)
        : baseScale;
      const level = clamp01(this.ambientMix[name]) * (authoredOwned ? 0 : priorityScale);
      this.proceduralTargets.set(name, level);
      if (gain) this.rampParam(gain.gain, level, seconds);
    }
  }

  testChannel(channel: "music" | "sfx" | "ambience"): void {
    void this.unlock().then(() => {
      if (channel === "music") void this.playSting("achievement");
      else if (channel === "sfx") void this.playSfx("cup", { force: true });
      else {
        const previous = { ...this.ambientMix };
        this.setAmbientMix({
          enabled: true,
          season: "summer",
          weatherKind: "clear",
          birds: .65,
          water: .45,
          wind: .35,
          murmur: 0,
          crickets: 0,
          rain: 0,
          bed: "parkland",
          paused: false,
        });
        globalThis.setTimeout(() => this.setAmbientMix(previous), 1400);
      }
    });
  }

  private applyImmediateMute(): void {
    this.musicSlots?.forEach((slot) => {
      this.fadeVersions.set(slot, (this.fadeVersions.get(slot) ?? 0) + 1);
      slot.volume = 0;
    });
    this.ambienceSlots?.forEach((slot) => {
      this.fadeVersions.set(slot, (this.fadeVersions.get(slot) ?? 0) + 1);
      slot.volume = 0;
    });
    if (this.ctx && this.sfxBus) {
      this.sfxBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.sfxBus.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    if (this.ctx && this.ambienceBus) {
      this.ambienceBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.ambienceBus.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  debugSnapshot(): AudioDebugSnapshot {
    const sourceCounts = Object.fromEntries(
      PROCEDURAL_FAMILIES.map((family) => [family, this.proceduralSourceCounts.get(family) ?? 0]),
    ) as Record<ProceduralAmbienceFamily, number>;
    const targets = Object.fromEntries(
      PROCEDURAL_FAMILIES.map((family) => [family, this.proceduralTargets.get(family) ?? 0]),
    ) as Record<ProceduralAmbienceFamily, number>;
    const actuals = Object.fromEntries(
      PROCEDURAL_FAMILIES.map((family) => [family, this.ambienceLayers.get(family)?.gain.value ?? 0]),
    ) as Record<ProceduralAmbienceFamily, number>;
    const activeAuthored = this.ambienceSlots?.[this.activeAmbienceSlot];
    return {
      unlocked: this.unlocked,
      contextState: this.ctx?.state ?? "unavailable",
      surface: this.surface,
      hidden: this.hidden,
      masterMuted: this.volumes.masterMuted,
      muteWhenHidden: this.volumes.muteWhenHidden,
      worldAmbienceAllowed: this.worldAmbienceAllowed(),
      authoredAmbienceAllowed: this.authoredAmbienceAllowed(),
      authoredNatureOwner: this.authoredNatureOwner(),
      authoredFallback: this.authoredAmbienceFallback,
      authoredFallbackBed: this.authoredAmbienceFallbackBed,
      authoredAttempts: {
        total: [...this.ambienceAttemptCounts.values()].reduce((sum, count) => sum + count, 0),
        inFlightBeds: [...this.ambienceInFlight.values()],
        current: this.currentAmbienceRequest
          ? {
              bed: this.currentAmbienceRequest.bed,
              generation: this.currentAmbienceRequest.generation,
            }
          : null,
      },
      authoredMedia: activeAuthored
        ? {
            trackId: activeAuthored.dataset.trackId ?? null,
            volume: activeAuthored.volume,
            paused: activeAuthored.paused,
            currentTime: activeAuthored.currentTime,
          }
        : null,
      mediaSlots: {
        music: this.musicSlots?.map((slot) => ({
          trackId: slot.dataset.trackId ?? null,
          volume: slot.volume,
          paused: slot.paused,
        })) ?? [],
        ambience: this.ambienceSlots?.map((slot) => ({
          trackId: slot.dataset.trackId ?? null,
          volume: slot.volume,
          paused: slot.paused,
        })) ?? [],
      },
      resolvedMusicContext: this.resolvedContext(),
      playingMusicContext: this.playingContext,
      playingAmbience: this.playingAmbience,
      priority: this.priority(),
      effectiveAmbienceBus: this.worldAmbienceAllowed() ? this.effective("ambienceVolume") : 0,
      actualAmbienceBusGain: this.ambienceBus?.gain.value ?? 0,
      proceduralSourceCount: this.ambienceSources.length,
      proceduralRampVersion: this.proceduralRampVersion,
      proceduralSourceCounts: sourceCounts,
      proceduralTargets: targets,
      proceduralActuals: actuals,
      desiredActiveProceduralFamilies: PROCEDURAL_FAMILIES.filter((family) => targets[family] > 0),
      actualActiveProceduralFamilies: PROCEDURAL_FAMILIES.filter((family) => actuals[family] > 0.00001),
      transition: {
        version: this.transitionVersion,
        ...this.lastTransition,
      },
    };
  }
}

export const audioManager = AudioManager.getInstance();
