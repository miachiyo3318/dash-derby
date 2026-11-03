// 効果音は音声ファイルを使わず Web Audio で合成する（オフラインでも鳴る）

export type Sfx = 'flip' | 'crash' | 'fall' | 'dq' | 'goal' | 'wind' | 'mud' | 'cheer' | 'spurt' | 'start';

const PREF_KEY = 'dash-derby-sound';
let ctx: AudioContext | null = null;
let enabled = readPref();

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundOn() {
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても鳴らし分けはできる
  }
  if (on) unlockAudio();
}

// iOS ではユーザー操作の中で AudioContext を作り直さないと音が出ない
export function unlockAudio() {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.15, endFreq?: number) {
  const c = ctx!;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + start + dur);
  gain.gain.setValueAtTime(vol, c.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.05);
}

function noise(start: number, dur: number, vol: number, filter: BiquadFilterType, from: number, to = from) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(from, c.currentTime + start);
  f.frequency.exponentialRampToValueAtTime(to, c.currentTime + start + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.001, c.currentTime + start);
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + start + Math.min(0.05, dur / 3));
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  src.connect(f).connect(gain).connect(c.destination);
  src.start(c.currentTime + start);
}

export function play(sfx: Sfx) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  switch (sfx) {
    case 'flip':
      noise(0, 0.08, 0.25, 'highpass', 2500);
      break;
    case 'crash':
      noise(0, 0.35, 0.6, 'lowpass', 1800, 200);
      tone(110, 0, 0.3, 'sine', 0.4, 50);
      break;
    case 'fall':
      tone(600, 0, 0.35, 'triangle', 0.2, 150);
      break;
    case 'dq':
      tone(160, 0, 0.25, 'sawtooth', 0.15);
      tone(120, 0.28, 0.45, 'sawtooth', 0.15);
      break;
    case 'goal':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, i === 3 ? 0.5 : 0.12, 'square', 0.12));
      break;
    case 'wind':
      noise(0, 0.8, 0.35, 'bandpass', 400, 2400);
      break;
    case 'mud':
      noise(0, 0.25, 0.4, 'lowpass', 500, 120);
      tone(90, 0.05, 0.2, 'sine', 0.3, 60);
      break;
    case 'cheer':
      noise(0, 1.2, 0.3, 'bandpass', 900, 1400);
      break;
    case 'spurt':
      [392, 494, 587, 784, 988].forEach((f, i) => tone(f, i * 0.07, 0.1, 'square', 0.1));
      break;
    case 'start':
      tone(440, 0, 0.15, 'square', 0.12);
      tone(440, 0.4, 0.15, 'square', 0.12);
      tone(880, 0.8, 0.4, 'square', 0.12);
      break;
  }
}
