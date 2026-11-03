import { describe, expect, it } from 'vitest';
import { commentary, cutinsFor } from './show';
import type { Turn } from './engine';

const names = ['A', 'B', 'C', 'D'];

describe('cutinsFor', () => {
  it('ぶつかって転んだ分は衝突のカットインにまとめる', () => {
    const c = cutinsFor(
      [
        { type: 'collide', by: 0, hit: 1 },
        { type: 'fall', racer: 1 },
      ],
      names,
    );
    expect(c.map((x) => x.kind)).toEqual(['collide']);
  });
  it('最大2つで、ゴールと失格を優先して元の順に並べる', () => {
    const c = cutinsFor(
      [
        { type: 'collide', by: 0, hit: 1 },
        { type: 'fall', racer: 2 },
        { type: 'dq', racer: 3 },
        { type: 'goal', racer: 0, place: 1 },
      ],
      names,
    );
    expect(c.map((x) => x.kind)).toEqual(['dq', 'goal']);
  });
  it('小さな出来事ではカットインを出さない', () => {
    expect(cutinsFor([], names)).toEqual([]);
  });
});

describe('commentary', () => {
  const base: Turn = { card: { kind: 'move', racer: 2, n: 3 }, event: null, log: [], effects: [] };
  it('先頭が入れ替わったら伝える', () => {
    expect(commentary(base, names, [0], [2], () => 0)).toContain('先頭がCに入れ替わった');
  });
  it('ゴールを最優先で伝える', () => {
    const t = { ...base, effects: [{ type: 'goal', racer: 2, place: 1 } as const] };
    expect(commentary(t, names, [2], [], () => 0)).toContain('C');
  });
});
