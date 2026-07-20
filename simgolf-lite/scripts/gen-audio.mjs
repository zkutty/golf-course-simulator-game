import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sampleRate = 22_050;
const seconds = 40;
const output = new URL("../public/audio/music/", import.meta.url);
mkdirSync(output, { recursive: true });

const songs = [
  ["clubhouse-morning", 92, 0, [0, 4, 7, 11]],
  ["porch-swing", 104, 5, [0, 3, 7, 10]],
  ["drafting-table", 112, 2, [0, 4, 7, 9]],
  ["breezy-nine", 118, 7, [0, 4, 7, 11]],
  ["fairway-stroll", 100, 9, [0, 3, 7, 10]],
  ["golden-green", 86, 4, [0, 4, 7, 11]],
  ["last-light", 76, 1, [0, 3, 6, 10]],
];

for (let songIndex = 0; songIndex < songs.length; songIndex++) {
  const [name, bpm, root, chord] = songs[songIndex];
  const frames = sampleRate * seconds;
  const pcm = Buffer.alloc(frames * 2);
  const beat = 60 / bpm;
  let noiseState = 0x9e3779b9 ^ songIndex;
  const random = () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return ((noiseState >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const beatIndex = Math.floor(t / beat);
    const phrase = Math.floor(beatIndex / 8) % 4;
    const local = t % beat;
    const env = Math.exp(-local * 2.7);
    const transpose = [0, 5, 7, 3][phrase];
    let value = 0;
    for (let note = 0; note < chord.length; note++) {
      const semitone = root + transpose + chord[note] + (note >= 2 ? 12 : 0);
      const frequency = 110 * Math.pow(2, semitone / 12);
      value += Math.sin(Math.PI * 2 * frequency * t + note * .7) * .055;
    }
    const melodyDegree = [0, 2, 4, 7, 4, 2, 9, 7][beatIndex % 8];
    const melodyHz = 220 * Math.pow(2, (root + transpose + melodyDegree) / 12);
    value += Math.sin(Math.PI * 2 * melodyHz * t) * env * .14;
    value += Math.sin(Math.PI * 2 * (55 * Math.pow(2, (root + transpose) / 12)) * t) * .1;
    const brush = local < .045 ? random() * Math.exp(-local * 70) * .08 : 0;
    const swingBrush = (t + beat * .5) % beat < .035 ? random() * .035 : 0;
    value += brush + swingBrush;
    const fade = Math.min(1, t / .7, (seconds - t) / .7);
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * fade * 32767))), i * 2);
  }
  const wav = join(tmpdir(), `coursecraft-${name}.wav`);
  writeWav(wav, pcm);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-ac", "2", "-c:a", "vorbis", "-strict", "-2", "-q:a", "4", new URL(`${name}.ogg`, output).pathname]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", new URL(`${name}.m4a`, output).pathname]);
  rmSync(wav);
}

function writeWav(path, pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}
