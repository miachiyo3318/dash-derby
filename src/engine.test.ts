import { describe, expect, it } from 'vitest';
import { applyCard, applyEvent, BURN_COUNT as BURN, buildDeck, drawNext, FINISH, newRace, scoreBet, seededRng, type Card } from './engine';

const names = ['A', 'B', 'C', 'D'];
const race = () => newRace(Array<Card>(10).fill({ kind: 'move', racer: 0, n: 1 }));

describe('scoreBet', () => {
  it('1着と2着の的中で得点とボーナス', () => {
    expect(scoreBet({ first: 0, second: 1 }, [0, 1, 2, 3], 0)).toBe(10);
    expect(scoreBet({ first: 0, second: 2 }, [0, 1, 2, 3], 0)).toBe(5);
    expect(scoreBet({ first: 3, second: 1 }, [0, 1, 2, 3], 0)).toBe(3);
    expect(scoreBet({ first: 1, second: 0 }, [0, 1, 2, 3], 0)).toBe(0);
  });
  it('3レース目は2倍', () => {
    expect(scoreBet({ first: 0, second: 1 }, [0, 1, 2, 3], 2)).toBe(20);
  });
});

describe('レース処理', () => {
  it('同じレーンで追い越すと止まっていた方が転び、もう一度転ぶと失格', () => {
    const s = race();
    s.racers[1].lane = 0;
    s.racers[1].pos = 2;
    applyCard(s, { kind: 'move', racer: 0, n: 3 }, names);
    expect(s.racers[1].fallen).toBe(true);
    applyCard(s, { kind: 'fall', racer: 1 }, names);
    expect(s.racers[1].status).toBe('dq');
    expect(s.racers[1].place).toBe(4);
  });

  it('転んでいると1マスしか進めず、立ち直ると元に戻る', () => {
    const s = race();
    applyCard(s, { kind: 'fall', racer: 0 }, names);
    applyCard(s, { kind: 'move', racer: 0, n: 3 }, names);
    expect(s.racers[0].pos).toBe(1);
    applyCard(s, { kind: 'recover', racer: 0 }, names);
    applyCard(s, { kind: 'move', racer: 0, n: 3 }, names);
    expect(s.racers[0].pos).toBe(4);
  });

  it('逆向きで前進すると後ろへ進むが、スタートより後ろには下がらない', () => {
    const s = race();
    s.racers[2].pos = 1;
    applyCard(s, { kind: 'turn', racer: 2 }, names);
    applyCard(s, { kind: 'move', racer: 2, n: 3 }, names);
    expect(s.racers[2].pos).toBe(0);
    expect(s.racers[2].status).toBe('running');
  });

  it('端のレーンから外へ車線変更すると失格', () => {
    const s = race();
    applyCard(s, { kind: 'swerve', racer: 0, n: 1, side: 'left' }, names);
    expect(s.racers[0].status).toBe('dq');
  });

  it('全員移動ではゴールしない', () => {
    const s = race();
    s.racers[0].pos = FINISH - 1;
    applyCard(s, { kind: 'all', moves: [3, 1, 1, 1] }, names);
    expect(s.racers[0].status).toBe('running');
  });

  it('3体が決着すると残りの順位も決まってレース終了', () => {
    const s = race();
    for (const r of [0, 1, 2]) {
      s.racers[r].pos = FINISH - 1;
      applyCard(s, { kind: 'move', racer: r, n: 1 }, names);
    }
    expect(s.over).toBe(true);
    expect(s.places).toEqual([0, 1, 2, 3]);
  });

  it('ランダムな山札で必ずレースが終わり、順位が埋まる', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const s = newRace(buildDeck(rng));
      let guard = 0;
      while (!s.over && guard++ < 1000) drawNext(s, names, rng);
      expect(s.over).toBe(true);
      expect([...s.places].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('混ぜ直しの上限を超えると写真判定で決着する', () => {
    const s = newRace(Array<Card>(BURN + 2).fill({ kind: 'turn', racer: 0 }));
    s.racers[1].pos = 5;
    let guard = 0;
    while (!s.over && guard++ < 100) drawNext(s, names, () => 0.99);
    expect(s.lastSpurt).toBe(true);
    expect(s.places[0]).toBe(1);
  });

  it('ラストスパート中は前進が1マス増える', () => {
    const s = race();
    s.lastSpurt = true;
    applyCard(s, { kind: 'move', racer: 0, n: 2 }, names);
    expect(s.racers[0].pos).toBe(3);
  });

  it('ラストスパート中でも逆走中の後退は増えない', () => {
    const s = race();
    s.lastSpurt = true;
    s.racers[0].pos = 5;
    s.racers[0].facing = -1;
    applyCard(s, { kind: 'move', racer: 0, n: 2 }, names);
    expect(s.racers[0].pos).toBe(3);
  });
});

describe('ランダムイベント', () => {
  it('向かい風で先頭が下がる', () => {
    const s = race();
    s.racers[3].pos = 10;
    applyEvent(s, 'headwind', names, seededRng(1));
    expect(s.racers[3].pos).toBe(8);
  });
  it('大歓声で転んだコマが全員起き上がる', () => {
    const s = race();
    s.racers[0].fallen = true;
    s.racers[2].fallen = true;
    applyEvent(s, 'cheer', names, seededRng(1));
    expect(s.racers.every((r) => !r.fallen)).toBe(true);
  });
  it('イベントでもスタートより後ろには下がらない', () => {
    const s = race();
    applyEvent(s, 'headwind', names, seededRng(1));
    expect(s.racers.every((r) => r.status === 'running' && r.pos === 0)).toBe(true);
  });
  it('つむじ風で2体のレーンが入れ替わる', () => {
    const s = race();
    applyEvent(s, 'gust', names, seededRng(3));
    expect(s.racers.map((r) => r.lane).sort()).toEqual([0, 1, 2, 3]);
    expect(s.racers.filter((r, i) => r.lane !== i)).toHaveLength(2);
  });
});

describe('山札', () => {
  it('失格したコマのカードは飛ばして次をめくる', () => {
    const s = newRace([
      ...Array<Card>(3).fill({ kind: 'turn', racer: 0 }),
      { kind: 'move', racer: 1, n: 3 },
      { kind: 'move', racer: 2, n: 2 },
    ]);
    s.racers[1].status = 'dq';
    const t = drawNext(s, names, () => 0.99);
    expect(t.card).toEqual({ kind: 'move', racer: 2, n: 2 });
    expect(s.racers[2].pos).toBe(2);
  });
});
