export type SoundName = "brush" | "confirm" | "cash";

type MaybeAudioContext = AudioContext | null;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function hasWebAudio() {
  return typeof window !== "undefined" && typeof (window as any).AudioContext !== "undefined";
}

export function createSoundPlayer() {
  let ctx: MaybeAudioContext = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;

  const last = {
    brush: 0,
    cash: 0,
    confirm: 0,
  };

  async function ensure() {
    if (!hasWebAudio()) return null;
    if (!ctx) {
      const AC = (window as any).AudioContext as typeof AudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22; // overall low volume
      master.connect(ctx.destination);
    }
    if (!ctx) return null;
    if (ctx.state === "suspended") {
      // Must be called in a user gesture handler to work reliably.
      await ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function getNoiseBuffer(context: AudioContext) {
    if (noiseBuf && noiseBuf.sampleRate === context.sampleRate) return noiseBuf;
    const dur = 0.065;
    const n = Math.max(1, Math.floor(context.sampleRate * dur));
    const b = context.createBuffer(1, n, context.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) {
      // soft-ish white noise
      d[i] = (Math.random() * 2 - 1) * 0.7;
    }
    noiseBuf = b;
    return b;
  }

  function connectToMaster(node: AudioNode) {
    if (master) node.connect(master);
  }

  function throttle(name: SoundName, minGapMs: number) {
    const t = nowMs();
    if (t - (last as any)[name] < minGapMs) return false;
    (last as any)[name] = t;
    return true;
  }

  async function playBrush(enabled: boolean) {
    if (!enabled) return;
    if (!throttle("brush", 40)) return;
    const context = await ensure();
    if (!context || !master) return;

    const t0 = context.currentTime;
    const src = context.createBufferSource();
    src.buffer = getNoiseBuffer(context);

    const lp = context.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    lp.Q.value = 0.7;

    const hp = context.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;

    const g = context.createGain();
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.045, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.07);

    src.connect(lp);
    lp.connect(hp);
    hp.connect(g);
    connectToMaster(g);

    src.start(t0);
    src.stop(t0 + 0.075);
  }

  async function playConfirm(enabled: boolean) {
    if (!enabled) return;
    if (!throttle("confirm", 120)) return;
    const context = await ensure();
    if (!context || !master) return;

    const t0 = context.currentTime;
    const g = context.createGain();
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.055, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.55);
    connectToMaster(g);

    const osc1 = context.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, t0); // C5

    const osc2 = context.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, t0 + 0.03); // G5

    osc1.connect(g);
    osc2.connect(g);

    osc1.start(t0);
    osc2.start(t0 + 0.03);
    osc1.stop(t0 + 0.38);
    osc2.stop(t0 + 0.52);
  }

  async function playCashTick(enabled: boolean) {
    if (!enabled) return;
    if (!throttle("cash", 250)) return;
    const context = await ensure();
    if (!context || !master) return;

    const t0 = context.currentTime;
    const g = context.createGain();
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.035, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.09);
    connectToMaster(g);

    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.10);
  }

  return {
    playBrush,
    playConfirm,
    playCashTick,
  };
}


