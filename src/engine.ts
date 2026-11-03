// レースとベットのルール処理。画面には依存しない。

export const RACER_COUNT = 4;
export const LANE_COUNT = 4;
export const FINISH = 20;
export const STARS = [4, 8, 12, 16];
export const RACE_COUNT = 3;
export const HAND_SIZE = 3;
export const DECK_SIZE = 18;
export const BURN_COUNT = 3;
export const SHRINK_STEP = 5;

export type Rng = () => number;

export type Card =
  | { kind: 'move'; racer: number; n: number }
  | { kind: 'star'; racer: number }
  | { kind: 'fall'; racer: number }
  | { kind: 'turn'; racer: number }
  | { kind: 'swerve'; racer: number; n: number; side: 'left' | 'right' }
  | { kind: 'recover'; racer: number }
  | { kind: 'all'; moves: number[] };

export type RacerStatus = 'running' | 'finished' | 'dq';

export interface Racer {
  lane: number;
  pos: number;
  facing: 1 | -1;
  fallen: boolean;
  status: RacerStatus;
  place: number | null;
}

export interface RaceState {
  racers: Racer[];
  deck: Card[];
  used: Card[];
  trackStart: number;
  places: (number | null)[]; // places[i] = i+1 着のレーサー
  over: boolean;
}

export interface Bet {
  first: number;
  second: number;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 各レーサーの基本カード（毎レース必ず山札に入る）
export function starterCards(): Card[] {
  return Array.from({ length: RACER_COUNT }, (_, r) => ({ kind: 'move', racer: r, n: 2 }) as Card);
}

// ランダムに引かれるカードの全体
export function cardPool(rng: Rng): Card[] {
  const pool: Card[] = [];
  for (let r = 0; r < RACER_COUNT; r++) {
    pool.push(
      { kind: 'move', racer: r, n: 1 },
      { kind: 'move', racer: r, n: 1 },
      { kind: 'move', racer: r, n: 2 },
      { kind: 'move', racer: r, n: 2 },
      { kind: 'move', racer: r, n: 3 },
      { kind: 'move', racer: r, n: -1 },
      { kind: 'star', racer: r },
      { kind: 'fall', racer: r },
      { kind: 'turn', racer: r },
      { kind: 'swerve', racer: r, n: 1, side: 'left' },
      { kind: 'swerve', racer: r, n: 1, side: 'right' },
      { kind: 'recover', racer: r },
    );
  }
  for (let i = 0; i < 5; i++) {
    pool.push({ kind: 'all', moves: Array.from({ length: RACER_COUNT }, () => 1 + Math.floor(rng() * 3)) });
  }
  return pool;
}

// 山札：基本カード + ランダムなカード + プレイヤーが入れたカード で DECK_SIZE 枚
export function buildDeck(playerCards: Card[], rng: Rng): Card[] {
  const randomCount = DECK_SIZE - RACER_COUNT - playerCards.length;
  const random = shuffle(cardPool(rng), rng).slice(0, Math.max(0, randomCount));
  return shuffle([...starterCards(), ...random, ...playerCards], rng);
}

export function newRace(deck: Card[]): RaceState {
  const state: RaceState = {
    racers: Array.from({ length: RACER_COUNT }, (_, i) => ({
      lane: i,
      pos: 0,
      facing: 1,
      fallen: false,
      status: 'running',
      place: null,
    })),
    deck: deck.slice(),
    used: [],
    trackStart: 0,
    places: Array(RACER_COUNT).fill(null),
    over: false,
  };
  burn(state);
  return state;
}

function burn(state: RaceState) {
  state.used.push(...state.deck.splice(0, BURN_COUNT));
}

function takeTopPlace(state: RaceState, r: number) {
  const i = state.places.indexOf(null);
  state.places[i] = r;
  state.racers[r].place = i + 1;
}

function takeBottomPlace(state: RaceState, r: number) {
  const i = state.places.lastIndexOf(null);
  state.places[i] = r;
  state.racers[r].place = i + 1;
}

export interface Ctx {
  state: RaceState;
  log: string[];
  names: string[];
}

function finish(ctx: Ctx, r: number) {
  ctx.state.racers[r].status = 'finished';
  takeTopPlace(ctx.state, r);
  ctx.log.push(`${ctx.names[r]}がゴール！（${ctx.state.racers[r].place}着）`);
}

function disqualify(ctx: Ctx, r: number, reason: string) {
  const racer = ctx.state.racers[r];
  if (racer.status !== 'running') return;
  racer.status = 'dq';
  racer.fallen = false;
  takeBottomPlace(ctx.state, r);
  ctx.log.push(`${ctx.names[r]}は${reason}で失格…`);
}

function knockDown(ctx: Ctx, r: number, cause: string) {
  const racer = ctx.state.racers[r];
  if (racer.status !== 'running') return;
  if (racer.fallen) {
    disqualify(ctx, r, '転倒中にさらに転んだの');
  } else {
    racer.fallen = true;
    ctx.log.push(`${ctx.names[r]}が${cause}`);
  }
}

// 1マスずつ進め、衝突・ゴール・後方はみ出しを判定する
function step(ctx: Ctx, r: number, dir: 1 | -1, count: number, opts: { collide: boolean; canFinish: boolean }) {
  const { state } = ctx;
  const racer = state.racers[r];
  for (let k = 0; k < count && racer.status === 'running'; k++) {
    const next = racer.pos + dir;
    if (dir === 1 && next >= FINISH) {
      if (!opts.canFinish) return;
      racer.pos = FINISH;
      finish(ctx, r);
      return;
    }
    if (next < state.trackStart) {
      racer.pos = next;
      disqualify(ctx, r, 'コースの後ろにはみ出したの');
      return;
    }
    racer.pos = next;
    if (opts.collide) {
      state.racers.forEach((o, i) => {
        if (i !== r && o.status === 'running' && o.lane === racer.lane && o.pos === racer.pos) {
          knockDown(ctx, i, `${ctx.names[r]}にぶつかられて転んだ`);
        }
      });
    }
  }
}

function moveRacer(ctx: Ctx, r: number, n: number, opts = { collide: true, canFinish: true }) {
  const racer = ctx.state.racers[r];
  if (racer.status !== 'running' || n === 0) return;
  const count = racer.fallen ? 1 : Math.abs(n);
  const dir = (racer.facing * Math.sign(n)) as 1 | -1;
  if (racer.fallen) ctx.log.push(`${ctx.names[r]}は転んでいるので1マスだけ`);
  step(ctx, r, dir, count, opts);
}

export function applyCard(state: RaceState, card: Card, names: string[]): string[] {
  const ctx: Ctx = { state, log: [], names };
  if (card.kind !== 'all' && state.racers[card.racer].status !== 'running') {
    ctx.log.push(`${names[card.racer]}はもうレースにいないので何も起きない`);
    return ctx.log;
  }
  switch (card.kind) {
    case 'move':
      moveRacer(ctx, card.racer, card.n);
      break;
    case 'star': {
      const racer = state.racers[card.racer];
      const targets = racer.facing === 1 ? [...STARS, FINISH].filter((s) => s > racer.pos) : STARS.filter((s) => s < racer.pos).reverse();
      const target = targets.find((s) => s >= state.trackStart);
      if (target === undefined) {
        ctx.log.push(`${names[card.racer]}の向いている方に星がない`);
      } else if (racer.fallen) {
        moveRacer(ctx, card.racer, 1);
      } else {
        step(ctx, card.racer, racer.facing, Math.abs(target - racer.pos), { collide: true, canFinish: true });
      }
      break;
    }
    case 'fall':
      knockDown(ctx, card.racer, '転んだ');
      break;
    case 'turn': {
      const racer = state.racers[card.racer];
      racer.facing = racer.facing === 1 ? -1 : 1;
      ctx.log.push(racer.facing === 1 ? `${names[card.racer]}が前を向いた` : `${names[card.racer]}が逆を向いた！`);
      break;
    }
    case 'swerve': {
      moveRacer(ctx, card.racer, card.n);
      const racer = state.racers[card.racer];
      if (racer.status !== 'running') break;
      // 左 = 進行方向に対して左。逆を向いていると左右が入れ替わる
      const delta = (card.side === 'left' ? -1 : 1) * racer.facing;
      racer.lane += delta;
      if (racer.lane < 0 || racer.lane >= LANE_COUNT) {
        disqualify(ctx, card.racer, 'コースの外に飛び出したの');
      } else {
        ctx.log.push(`${names[card.racer]}がレーンを移った`);
        state.racers.forEach((o, i) => {
          if (i !== card.racer && o.status === 'running' && o.lane === racer.lane && o.pos === racer.pos) {
            knockDown(ctx, i, `${names[card.racer]}にぶつかられて転んだ`);
          }
        });
      }
      break;
    }
    case 'recover': {
      const racer = state.racers[card.racer];
      racer.fallen = false;
      racer.facing = 1;
      ctx.log.push(`${names[card.racer]}が立ち直った`);
      break;
    }
    case 'all':
      // 全員移動ではぶつからず、ゴールもしない（線の手前で止まる）
      card.moves.forEach((n, r) => moveRacer(ctx, r, n, { collide: false, canFinish: false }));
      ctx.log.push('全員がいっせいに動いた');
      break;
  }
  checkRaceOver(ctx);
  return ctx.log;
}

function checkRaceOver(ctx: Ctx) {
  const { state } = ctx;
  const running = state.racers.map((r, i) => (r.status === 'running' ? i : -1)).filter((i) => i >= 0);
  if (running.length <= 1) {
    for (const r of running) {
      state.racers[r].status = 'finished';
      takeTopPlace(state, r);
      ctx.log.push(`残った${ctx.names[r]}は${state.racers[r].place}着`);
    }
    state.over = true;
  }
}

// 山札が尽きたら使ったカードを混ぜ直し、スタート側からコースを縮める
function reshuffle(ctx: Ctx, rng: Rng) {
  const { state } = ctx;
  state.deck = shuffle(state.used, rng);
  state.used = [];
  state.trackStart = Math.min(state.trackStart + SHRINK_STEP, FINISH - 1);
  ctx.log.push('山札を混ぜ直し、コースが短くなった！');
  state.racers.forEach((r, i) => {
    if (r.status === 'running' && r.pos < state.trackStart) disqualify(ctx, i, 'コースが縮んで取り残されたの');
  });
  checkRaceOver(ctx);
  if (!state.over) burn(state);
}

export interface Turn {
  card: Card | null;
  log: string[];
}

export function drawNext(state: RaceState, names: string[], rng: Rng): Turn {
  const ctx: Ctx = { state, log: [], names };
  if (state.over) return { card: null, log: [] };
  if (state.deck.length === 0) reshuffle(ctx, rng);
  if (state.over) return { card: null, log: ctx.log };
  const card = state.deck.shift()!;
  state.used.push(card);
  return { card, log: [...ctx.log, ...applyCard(state, card, names)] };
}

export function scoreBet(bet: Bet, places: (number | null)[], raceIndex: number): number {
  let pts = 0;
  if (places[0] === bet.first) pts += 5;
  if (places[1] === bet.second) pts += 3;
  if (places[0] === bet.first && places[1] === bet.second) pts += 2;
  return raceIndex === RACE_COUNT - 1 ? pts * 2 : pts;
}

export function describeCard(card: Card, names: string[]): string {
  switch (card.kind) {
    case 'move':
      return card.n > 0 ? `${names[card.racer]} ${card.n}マス進む` : `${names[card.racer]} ${-card.n}マス下がる`;
    case 'star':
      return `${names[card.racer]} 次の★まで進む`;
    case 'fall':
      return `${names[card.racer]} 転ぶ`;
    case 'turn':
      return `${names[card.racer]} 向きを変える`;
    case 'swerve':
      return `${names[card.racer]} ${card.n}マス進んで${card.side === 'left' ? '左' : '右'}へ`;
    case 'recover':
      return `${names[card.racer]} 立ち直る`;
    case 'all':
      return `全員 ${card.moves.join('・')}マス進む`;
  }
}
