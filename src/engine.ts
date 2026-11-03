// レースとベットのルール処理。画面には依存しない。

export const RACER_COUNT = 4;
export const LANE_COUNT = 4;
export const FINISH = 14;
export const STARS = [4, 7, 10];
export const RACE_COUNT = 3;
export const HAND_SIZE = 3;
export const DECK_SIZE = 24;
export const MAX_RESHUFFLES = 2;
export const BURN_COUNT = 3;
export const EVENT_CHANCE = 0.2;

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
  reshuffles: number;
  lastSpurt: boolean;
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

// 山札：基本カード + ランダムなカード (+ 任意で追加カード) で DECK_SIZE 枚
export function buildDeck(playerCards: Card[], rng: Rng): Card[] {
  const randomCount = DECK_SIZE - RACER_COUNT - playerCards.length;
  const random = shuffle(cardPool(rng), rng).slice(0, Math.max(0, randomCount));
  return shuffle([...starterCards(), ...random, ...playerCards], rng);
}

export function newRace(deck: Card[], lanes: number[] = [0, 1, 2, 3]): RaceState {
  const state: RaceState = {
    racers: Array.from({ length: RACER_COUNT }, (_, i) => ({
      lane: lanes[i],
      pos: 0,
      facing: 1,
      fallen: false,
      status: 'running',
      place: null,
    })),
    deck: deck.slice(),
    used: [],
    reshuffles: 0,
    lastSpurt: false,
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
    if (next < 0) return; // スタート地点より後ろには下がらない
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
  const boost = ctx.state.lastSpurt && n > 0 && opts.collide ? 1 : 0;
  const count = racer.fallen ? 1 : Math.abs(n) + boost;
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
      const target = targets[0];
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

// 山札が尽きたら混ぜ直してラストスパート（前進+1）。混ぜ直しの上限を超えたら写真判定
function deckOut(ctx: Ctx, rng: Rng) {
  const { state } = ctx;
  if (state.reshuffles < MAX_RESHUFFLES) {
    state.deck = shuffle(state.used, rng);
    state.used = [];
    state.reshuffles++;
    if (!state.lastSpurt) {
      state.lastSpurt = true;
      ctx.log.push('山札を混ぜ直し、ラストスパート！ 前に進むカードが1マス増える');
    } else {
      ctx.log.push('山札を混ぜ直し！ これが最後の山札');
    }
    burn(state);
    return;
  }
  ctx.log.push('山札が尽きた！ 写真判定で順位を決める');
  const running = state.racers
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === 'running')
    .sort((a, b) => b.r.pos - a.r.pos || a.i - b.i);
  for (const { r, i } of running) {
    r.status = 'finished';
    takeTopPlace(state, i);
    ctx.log.push(`${ctx.names[i]}は${r.place}着`);
  }
  state.over = true;
}

export type EventKind = 'tailwind' | 'mud' | 'headwind' | 'cheer' | 'gust';

export const EVENT_TITLES: Record<EventKind, string> = {
  tailwind: '追い風',
  mud: 'ぬかるみ',
  headwind: '向かい風',
  cheer: '大歓声',
  gust: 'つむじ風',
};

const NO_CONTACT = { collide: false, canFinish: false };

// 複数のコマに同時に効く突発イベント。ぶつからず、ゴールもしない
export function applyEvent(state: RaceState, kind: EventKind, names: string[], rng: Rng): string[] {
  const ctx: Ctx = { state, log: [], names };
  const running = state.racers.map((r, i) => (r.status === 'running' ? i : -1)).filter((i) => i >= 0);
  switch (kind) {
    case 'tailwind': {
      const lucky = shuffle(running, rng).slice(0, Math.min(running.length, 2 + Math.floor(rng() * 2)));
      ctx.log.push(`追い風！ ${lucky.map((r) => names[r]).join('・')}が押し出される`);
      lucky.forEach((r) => moveRacer(ctx, r, 2, NO_CONTACT));
      break;
    }
    case 'mud': {
      const from = 1 + Math.floor(rng() * (FINISH - 5));
      const to = from + 4;
      const stuck = running.filter((r) => state.racers[r].pos >= from && state.racers[r].pos <= to);
      ctx.log.push(`${from}〜${to}マスがぬかるみに！`);
      if (stuck.length === 0) ctx.log.push('…でも誰もいなかった');
      stuck.forEach((r) => {
        ctx.log.push(`${names[r]}が足を取られて後ずさり`);
        step(ctx, r, -1, 2, NO_CONTACT);
      });
      break;
    }
    case 'headwind': {
      const lead = Math.max(...running.map((r) => state.racers[r].pos));
      const hit = running.filter((r) => state.racers[r].pos === lead);
      ctx.log.push(`向かい風！ 先頭の${hit.map((r) => names[r]).join('・')}が押し戻される`);
      hit.forEach((r) => step(ctx, r, -1, 2, NO_CONTACT));
      break;
    }
    case 'cheer': {
      const fallen = running.filter((r) => state.racers[r].fallen);
      ctx.log.push('観客席から大歓声！');
      if (fallen.length === 0) ctx.log.push('みんな元気いっぱい');
      fallen.forEach((r) => {
        state.racers[r].fallen = false;
        ctx.log.push(`${names[r]}が起き上がった`);
      });
      break;
    }
    case 'gust': {
      const [a, b] = shuffle(running, rng);
      if (b === undefined) break;
      const ra = state.racers[a];
      const rb = state.racers[b];
      [ra.lane, rb.lane] = [rb.lane, ra.lane];
      ctx.log.push(`つむじ風！ ${names[a]}と${names[b]}のレーンが入れ替わった`);
      break;
    }
  }
  checkRaceOver(ctx);
  return ctx.log;
}

export interface Turn {
  card: Card | null;
  event: EventKind | null;
  log: string[];
}

export function drawNext(state: RaceState, names: string[], rng: Rng): Turn {
  const ctx: Ctx = { state, log: [], names };
  if (state.over) return { card: null, event: null, log: [] };
  if (state.deck.length === 0) deckOut(ctx, rng);
  if (state.over) return { card: null, event: null, log: ctx.log };
  if (rng() < EVENT_CHANCE) {
    const kinds = Object.keys(EVENT_TITLES) as EventKind[];
    const event = kinds[Math.floor(rng() * kinds.length)];
    return { card: null, event, log: [...ctx.log, ...applyEvent(state, event, names, rng)] };
  }
  // もうレースにいないコマのカードは飛ばす
  while (state.deck.length > 0) {
    const card = state.deck.shift()!;
    state.used.push(card);
    if (card.kind === 'all' || state.racers[card.racer].status === 'running') {
      return { card, event: null, log: [...ctx.log, ...applyCard(state, card, names)] };
    }
  }
  return { card: null, event: null, log: ctx.log };
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
