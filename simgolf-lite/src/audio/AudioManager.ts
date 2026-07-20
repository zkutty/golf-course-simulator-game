import { loadAppProfile, updateProfileTab } from "../game/onboarding/profile";

export interface AudioVolumes {
  masterVolume: number;
  musicVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
  masterMuted: boolean;
  muteWhenHidden: boolean;
}

export type MusicContext = "silent" | "title" | "build" | "live" | "tension";
export type StingName = "celebration" | "record" | "achievement";
export type SfxName =
  | "brush" | "confirm" | "cash" | "button" | "tab" | "error" | "sculpt"
  | "driver" | "iron" | "chip" | "putt"
  | "land-fairway" | "land-green" | "land-sand" | "land-water"
  | "land-rough" | "tree" | "cup" | "crowd-cheer" | "crowd-groan";

export interface AmbientMix {
  birds: number;
  water: number;
  wind: number;
  murmur: number;
  crickets: number;
  paused: boolean;
}

interface Track {
  id: string;
  ogg: string;
  m4a: string;
}

export const MUSIC_PLAYLISTS: Record<Exclude<MusicContext, "silent">, readonly Track[]> = {
  title: [track("clubhouse-morning"), track("porch-swing")],
  build: [track("drafting-table"), track("breezy-nine")],
  live: [track("fairway-stroll"), track("golden-green")],
  tension: [track("last-light"), track("drafting-table")],
};

function track(id: string): Track {
  return { id, ogg: `/audio/music/${id}.ogg`, m4a: `/audio/music/${id}.m4a` };
}

function loadVolumes(): AudioVolumes {
  return { ...loadAppProfile().audio };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

class AudioManager {
  private static instance: AudioManager | null = null;
  private unlocked = false;
  private volumes: AudioVolumes = loadVolumes();
  private hidden = typeof document !== "undefined" && document.hidden;
  private pauseDuck = 1;
  private stingDuck = 1;
  private context: MusicContext = "silent";
  private playingContext: MusicContext = "silent";
  private override: MusicContext | null = null;
  private trackIndex = new Map<MusicContext, number>();
  private contextPositions = new Map<MusicContext, number>();
  private musicSlots: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private activeSlot = 0;
  private musicFadeToken = 0;
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private ambienceLayers = new Map<keyof Omit<AmbientMix, "paused">, GainNode>();
  private ambienceSources: AudioBufferSourceNode[] = [];
  private ambientMix: AmbientMix = { birds: 0, water: 0, wind: 0, murmur: 0, crickets: 0, paused: true };
  private voices = new Set<AudioScheduledSourceNode>();
  private lastPlayed = new Map<SfxName, number>();
  private readonly MAX_VOICES = 8;

  private constructor() {
    if (typeof Audio !== "undefined") {
      this.musicSlots = [this.createMusicElement(), this.createMusicElement()];
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

  private effective(channel: "musicVolume" | "ambienceVolume" | "sfxVolume"): number {
    if (this.volumes.masterMuted || (this.hidden && this.volumes.muteWhenHidden)) return 0;
    const duck = channel === "musicVolume" ? this.pauseDuck * this.stingDuck : 1;
    return clamp01(this.volumes.masterVolume * this.volumes[channel] * duck);
  }

  private preferredSource(track: Track): string {
    const probe = this.musicSlots?.[0];
    return probe?.canPlayType("audio/ogg; codecs=vorbis") ? track.ogg : track.m4a;
  }

  private rampParam(param: AudioParam, value: number, seconds = 0.08): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(clamp01(value), t + seconds);
  }

  private rampAll(seconds = 0.08): void {
    const music = this.effective("musicVolume");
    this.musicSlots?.forEach((slot, index) => {
      this.fadeElement(slot, index === this.activeSlot ? music : 0, seconds * 1000, false, this.musicFadeToken);
    });
    if (this.sfxBus) this.rampParam(this.sfxBus.gain, this.effective("sfxVolume"), seconds);
    if (this.ambienceBus) this.rampParam(this.ambienceBus.gain, this.effective("ambienceVolume"), seconds);
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const Context = typeof window === "undefined" ? undefined : window.AudioContext;
    if (Context) {
      this.ctx = new Context();
      this.sfxBus = this.ctx.createGain();
      this.ambienceBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.effective("sfxVolume");
      this.ambienceBus.gain.value = this.effective("ambienceVolume");
      this.sfxBus.connect(this.ctx.destination);
      this.ambienceBus.connect(this.ctx.destination);
      await this.ctx.resume().catch(() => undefined);
      this.createAmbientBed();
      this.scheduleAmbientAccent();
    }
    this.unlocked = true;
    if (this.resolvedContext() !== "silent") await this.switchPlaylist(this.resolvedContext());
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
    this.pauseDuck = paused ? 0.45 : 1;
    this.rampAll(0.25);
  }

  setMusicContext(context: MusicContext): Promise<void> {
    this.context = context;
    return this.switchPlaylist(this.resolvedContext());
  }

  setMusicOverride(context: MusicContext | null): Promise<void> {
    this.override = context;
    return this.switchPlaylist(this.resolvedContext());
  }

  private resolvedContext(): MusicContext {
    return this.override ?? this.context;
  }

  private async switchPlaylist(context: MusicContext): Promise<void> {
    if (!this.unlocked || !this.musicSlots) return;
    const old = this.musicSlots[this.activeSlot];
    if (this.playingContext !== "silent" && old.currentTime > 0 && !old.ended) this.contextPositions.set(this.playingContext, old.currentTime);
    if (context === "silent") {
      const token = ++this.musicFadeToken;
      this.fadeElement(old, 0, 450, true, token);
      return;
    }
    const list = MUSIC_PLAYLISTS[context];
    const index = this.trackIndex.get(context) ?? 0;
    const selected = list[index % list.length];
    const src = this.preferredSource(selected);
    if (old.dataset.trackId === selected.id && !old.paused) {
      this.rampAll();
      return;
    }
    const nextSlot = this.activeSlot === 0 ? 1 : 0;
    const next = this.musicSlots[nextSlot];
    next.src = src;
    next.dataset.trackId = selected.id;
    next.currentTime = this.contextPositions.get(context) ?? 0;
    next.volume = 0;
    const token = ++this.musicFadeToken;
    try {
      await next.play();
    } catch {
      return;
    }
    this.activeSlot = nextSlot;
    this.playingContext = context;
    this.fadeElement(old, 0, 2000, true, token);
    this.fadeElement(next, this.effective("musicVolume"), 2000, false, token);
  }

  private fadeElement(audio: HTMLAudioElement, target: number, durationMs: number, pauseAtEnd: boolean, token: number): void {
    const from = audio.volume;
    const start = nowMs();
    const tick = () => {
      if (token !== this.musicFadeToken && pauseAtEnd) return;
      const p = Math.min(1, (nowMs() - start) / Math.max(1, durationMs));
      audio.volume = clamp01(from + (target - from) * (p * p * (3 - 2 * p)));
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
    await this.switchPlaylist(context);
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
    const configs: Array<[keyof Omit<AmbientMix, "paused">, BiquadFilterType, number]> = [
      ["birds", "highpass", 1900], ["water", "bandpass", 760], ["wind", "lowpass", 520],
      ["murmur", "bandpass", 340], ["crickets", "highpass", 3100],
    ];
    for (const [name, type, frequency] of configs) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = name === "water" ? .72 : name === "birds" ? 1.7 : 1;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(bus);
      source.start();
      this.ambienceSources.push(source);
      this.ambienceLayers.set(name, gain);
    }
  }

  private scheduleAmbientAccent(): void {
    globalThis.setTimeout(() => {
      this.playAmbientAccent();
      this.scheduleAmbientAccent();
    }, 18_000 + Math.random() * 22_000);
  }

  private playAmbientAccent(): void {
    const ctx = this.ctx;
    const bus = this.ambienceBus;
    if (!ctx || !bus || this.ambientMix.paused || this.effective("ambienceVolume") <= 0) return;
    const t = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const bird = this.ambientMix.birds >= Math.max(this.ambientMix.murmur, this.ambientMix.wind);
    const crowd = !bird && this.ambientMix.murmur > .3;
    oscillator.type = bird ? "sine" : crowd ? "triangle" : "sawtooth";
    oscillator.frequency.setValueAtTime(bird ? 1450 : crowd ? 240 : 72, t);
    oscillator.frequency.exponentialRampToValueAtTime(bird ? 2350 : crowd ? 170 : 58, t + (bird ? .22 : .8));
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.linearRampToValueAtTime(bird ? .045 : .025, t + .08);
    gain.gain.exponentialRampToValueAtTime(.0001, t + (bird ? .65 : 1.4));
    oscillator.connect(gain).connect(bus);
    oscillator.start(t);
    oscillator.stop(t + (bird ? .7 : 1.45));
  }

  setAmbientMix(mix: AmbientMix): void {
    this.ambientMix = { ...mix };
    if (!this.ctx) return;
    const scale = mix.paused ? 0.12 : 1;
    for (const name of ["birds", "water", "wind", "murmur", "crickets"] as const) {
      const gain = this.ambienceLayers.get(name);
      if (gain) this.rampParam(gain.gain, clamp01(mix[name]) * scale, 1);
    }
  }

  testChannel(channel: "music" | "sfx" | "ambience"): void {
    void this.unlock().then(() => {
      if (channel === "music") void this.playSting("achievement");
      else if (channel === "sfx") void this.playSfx("cup", { force: true });
      else {
        const previous = { ...this.ambientMix };
        this.setAmbientMix({ birds: .65, water: .45, wind: .35, murmur: 0, crickets: 0, paused: false });
        globalThis.setTimeout(() => this.setAmbientMix(previous), 1400);
      }
    });
  }

  private applyImmediateMute(): void {
    this.musicSlots?.forEach((slot) => { slot.volume = 0; });
    if (this.sfxBus) this.sfxBus.gain.value = 0;
    if (this.ambienceBus) this.ambienceBus.gain.value = 0;
  }
}

export const audioManager = AudioManager.getInstance();
