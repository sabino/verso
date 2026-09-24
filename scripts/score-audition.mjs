/** Repeatable score-only listening reel. The Web Audio mixer adds live ambience, Foley and filtering. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composePhrase, scoreTable } from '../src/adaptive-score.ts';
import { worldTimeAt } from '../src/stichos/world-time.ts';

const rate = 24000;
const location = {
  biome: 'woodland',
  terrain: 'grass',
  interior: false,
  temperature: 12,
  settlement: false,
  featureDistances: { water: Infinity, trees: 2, fire: Infinity },
  weather: 'clear',
};
const scenes = [
  ['Open air · day', 0, location, worldTimeAt(0), 0, {}],
  [
    'Home · day',
    0,
    { ...location, interior: true, buildingKind: 'house' },
    worldTimeAt(0),
    0,
    { home: true },
  ],
  ['Danger · dusk', 0, location, worldTimeAt(10 * 60), 0.8, {}],
  ['Open air · quiet phrase', 3, location, worldTimeAt(0), 0, {}],
];
const tables = new Map();
const table = (kind) => {
  if (!tables.has(kind)) tables.set(kind, scoreTable(kind));
  return tables.get(kind);
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function render(phrase) {
  const beatSeconds = 60 / phrase.bpm;
  const duration = 12 * beatSeconds;
  const count = Math.ceil((duration + 0.4) * rate);
  const left = new Float32Array(count),
    right = new Float32Array(count);
  for (const note of phrase.notes) {
    if (note.beat >= 12) continue;
    const start = Math.floor(note.beat * beatSeconds * rate);
    const seconds = note.duration * beatSeconds;
    const end = Math.min(count, start + Math.ceil((seconds + 0.17) * rate));
    const percussion = note.instrument === 'drum' || note.instrument === 'brush';
    const attack = percussion ? 0.008 : note.instrument === 'bowed' ? 0.16 : 0.065;
    const samples = table(note.instrument);
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const panL = Math.sqrt((1 - note.pan) / 2),
      panR = Math.sqrt((1 + note.pan) / 2);
    const cutoff =
      note.instrument === 'flute'
        ? 3600
        : note.instrument === 'bowed'
          ? 2400
          : percussion
            ? 1300
            : 4200;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
    let phase = 0,
      filtered = 0,
      noise = (phrase.seed ^ (note.beat * 8191)) >>> 0;
    for (let i = start; i < end; i++) {
      const t = (i - start) / rate;
      const step =
        (frequency * (note.instrument === 'drum' ? 0.55 + 0.45 * Math.exp(-t / 0.045) : 1)) / rate;
      phase = (phase + step) % 1;
      let sample;
      if (note.instrument === 'brush') {
        noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
        sample = noise / 2147483648 - 1;
      } else {
        const position = phase * samples.length;
        const index = Math.floor(position);
        sample =
          samples[index] +
          (samples[(index + 1) % samples.length] - samples[index]) * (position - index);
      }
      filtered += alpha * (sample - filtered);
      const envelope = percussion
        ? Math.min(1, t / attack) * Math.exp((-9.21 * t) / seconds)
        : t < attack
          ? t / Math.min(attack, seconds / 4)
          : t < seconds - 0.16
            ? 1
            : clamp((seconds + 0.16 - t) / 0.32, 0, 1) * 0.83;
      const value = filtered * envelope * note.gain;
      left[i] += value * panL;
      right[i] += value * panR;
    }
  }
  return { left, right, duration };
}

function wave(left, right, gain) {
  const bytes = Buffer.alloc(44 + left.length * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(left.length * 4, 40);
  for (let i = 0; i < left.length; i++) {
    bytes.writeInt16LE(Math.round(clamp(left[i] * gain, -1, 1) * 32767), 44 + i * 4);
    bytes.writeInt16LE(Math.round(clamp(right[i] * gain, -1, 1) * 32767), 46 + i * 4);
  }
  return bytes;
}

export function scoreAudition(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const segments = [];
  const phrases = scenes.map(([label, index, place, time, danger, context]) => {
    const phrase = composePhrase(8, index, place, time, danger, context);
    const audio = render(phrase);
    segments.push({
      label,
      index,
      zone: phrase.zone,
      identity: phrase.identity,
      bpm: phrase.bpm,
      notes: phrase.notes.length,
      seconds: +audio.duration.toFixed(2),
    });
    return audio;
  });
  if (segments.at(-1).notes !== 0) throw Error('Expected a truly quiet open-air phrase.');
  const gap = Math.floor(rate * 0.45);
  const length = phrases.reduce((sum, p) => sum + p.left.length + gap, 0);
  const left = new Float32Array(length),
    right = new Float32Array(length);
  let cursor = 0;
  for (const p of phrases) {
    left.set(p.left, cursor);
    right.set(p.right, cursor);
    cursor += p.left.length + gap;
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  fs.writeFileSync(
    path.join(directory, 'score-audition.wav'),
    wave(left, right, peak > 0 ? Math.min(8, 0.8 / peak) : 1),
  );
  fs.writeFileSync(
    path.join(directory, 'score-audition.json'),
    JSON.stringify(
      {
        seed: 8,
        sampleRate: rate,
        format: 'stereo PCM 16-bit',
        note: 'Score-only listening preview using the composer and instrument tables; the live Web Audio mix also includes ambience, Foley, filtering and reverb.',
        segments,
      },
      null,
      2,
    ),
  );
  return segments;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(scoreAudition(path.resolve(process.argv[2] ?? '.dream-loop/ci-browser')));
