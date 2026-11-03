// レース中の出来事から、カットインと実況テロップの中身を決める（画面には依存しない）

import { type Effect, type EventKind, type Turn } from './engine';
import type { Sfx } from './sound';

export interface CutIn {
  kind: 'collide' | 'fall' | 'dq' | 'goal' | 'spurt' | EventKind;
  title: string;
  sub: string;
  racers: number[];
  sfx: Sfx;
}

const EVENT_CUTIN: Record<EventKind, { title: string; sfx: Sfx }> = {
  tailwind: { title: '追い風！', sfx: 'wind' },
  mud: { title: 'ぬかるみ！', sfx: 'mud' },
  headwind: { title: '向かい風！', sfx: 'wind' },
  cheer: { title: '大歓声！', sfx: 'cheer' },
  gust: { title: 'つむじ風！', sfx: 'wind' },
};

export const MAX_CUTINS = 2;

// 1回のめくりで出すカットイン。うるさくならないよう大きな出来事だけ、最大2つ
export function cutinsFor(effects: Effect[], names: string[]): CutIn[] {
  const out: CutIn[] = [];
  const collided = new Set(effects.filter((e) => e.type === 'collide').map((e) => (e as { hit: number }).hit));
  for (const e of effects) {
    switch (e.type) {
      case 'collide':
        out.push({ kind: 'collide', title: 'ドカーン！', sub: `${names[e.by]}が${names[e.hit]}に激突`, racers: [e.by, e.hit], sfx: 'crash' });
        break;
      case 'fall':
        // ぶつかって転んだ分は衝突のカットインに含める
        if (!collided.has(e.racer)) out.push({ kind: 'fall', title: 'ズザーッ！', sub: `${names[e.racer]}が転んだ`, racers: [e.racer], sfx: 'fall' });
        break;
      case 'dq':
        out.push({ kind: 'dq', title: '失格！', sub: `${names[e.racer]}はここでリタイア`, racers: [e.racer], sfx: 'dq' });
        break;
      case 'goal':
        out.push({ kind: 'goal', title: `${e.place}着 ゴール！`, sub: names[e.racer], racers: [e.racer], sfx: 'goal' });
        break;
      case 'spurt':
        out.push({ kind: 'spurt', title: 'ラストスパート！', sub: '前に進むカードが1マス増える', racers: [], sfx: 'spurt' });
        break;
      case 'event': {
        const c = EVENT_CUTIN[e.kind];
        const who = e.racers.map((r) => names[r]).join('・');
        out.push({ kind: e.kind, title: c.title, sub: eventSub(e.kind, who, e.from, e.to), racers: e.racers, sfx: c.sfx });
        break;
      }
    }
  }
  // 失格・ゴールは見逃したくないので優先して残す
  const rank = (c: CutIn) => (c.kind === 'goal' || c.kind === 'dq' ? 0 : 1);
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .slice(0, MAX_CUTINS)
    .sort((a, b) => a.i - b.i)
    .map(({ c }) => c);
}

function eventSub(kind: EventKind, who: string, from?: number, to?: number): string {
  switch (kind) {
    case 'tailwind':
      return `${who}が押し出される`;
    case 'mud':
      return who ? `${from}〜${to}マスで${who}が足を取られた` : `${from}〜${to}マスがぬかるみに`;
    case 'headwind':
      return `先頭の${who}が押し戻される`;
    case 'cheer':
      return who ? `${who}が起き上がった` : '観客席が大盛り上がり';
    case 'gust':
      return `${who}のレーンが入れ替わった`;
  }
}

const pick = <T>(items: T[], rng: () => number) => items[Math.floor(rng() * items.length)];

// 実況テロップ。1回のめくりにつき1行
export function commentary(turn: Turn, names: string[], leaderBefore: number[], leaderAfter: number[], rng: () => number): string {
  const n = (r: number) => names[r];
  const goal = turn.effects.find((e) => e.type === 'goal');
  if (goal?.type === 'goal') {
    return goal.place === 1
      ? pick([`${n(goal.racer)}、先頭でゴールイン！ 見事な走りだ！`, `1着は${n(goal.racer)}！ 堂々のゴール！`], rng)
      : `${n(goal.racer)}、${goal.place}着でゴール！`;
  }
  const dq = turn.effects.find((e) => e.type === 'dq');
  if (dq?.type === 'dq') return pick([`なんと${n(dq.racer)}、ここで失格！`, `ああっと${n(dq.racer)}、無念の失格！`], rng);
  const hit = turn.effects.find((e) => e.type === 'collide');
  if (hit?.type === 'collide') return pick([`おっと！ ${n(hit.by)}が${n(hit.hit)}に激突！`, `${n(hit.by)}、${n(hit.hit)}を巻き込んだ！`], rng);
  const fall = turn.effects.find((e) => e.type === 'fall');
  if (fall?.type === 'fall') return pick([`${n(fall.racer)}、ここで転倒！`, `あーっと${n(fall.racer)}がすってんころりん！`], rng);
  if (turn.effects.some((e) => e.type === 'spurt')) return '山札が一巡！ ここからラストスパートだ！';
  if (turn.event) return pick(['おーっと、ここで天気が急変！', 'コースに異変だ！'], rng) + ' ' + (turn.log[0] ?? '');

  const lead = leaderAfter.length === 1 && !sameSet(leaderBefore, leaderAfter) ? `先頭が${n(leaderAfter[0])}に入れ替わった！` : '';
  const card = turn.card;
  if (!card) return turn.log[0] ?? '';
  let line = '';
  switch (card.kind) {
    case 'move':
      line = card.n >= 3 ? `${n(card.racer)}、ぐんぐん加速！` : card.n > 0 ? `${n(card.racer)}、じわりと前へ` : `${n(card.racer)}、少し後退`;
      break;
    case 'star':
      line = `${n(card.racer)}、星をめがけて一直線！`;
      break;
    case 'turn':
      line = pick([`${n(card.racer)}、まさかの逆走！`, `${n(card.racer)}がくるりと向きを変えた`], rng);
      break;
    case 'swerve':
      line = `${n(card.racer)}、レーンを変えて勝負に出た`;
      break;
    case 'recover':
      line = `${n(card.racer)}、体勢を立て直す`;
      break;
    case 'all':
      line = '全員そろって前へ！';
      break;
    case 'fall':
      line = turn.log[0] ?? '';
      break;
  }
  return lead ? `${line} ${lead}` : line;
}

function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
