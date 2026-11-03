import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  buildDeck,
  describeCard,
  drawNext,
  EVENT_TITLES,
  FINISH,
  LANE_COUNT,
  newRace,
  RACE_COUNT,
  scoreBet,
  shuffle,
  STARS,
  type Bet,
  type RaceState,
  type Turn,
} from './engine';

registerSW({ immediate: true });

const RACERS = [
  { name: 'ペンタ', icon: '🐧', color: '#3a86ff' },
  { name: 'ケロ', icon: '🐸', color: '#2a9d8f' },
  { name: 'ミケ', icon: '🐱', color: '#f4a261' },
  { name: 'ラビ', icon: '🐰', color: '#e76f8a' },
];
const NAMES = RACERS.map((r) => r.name);
const STEP_MS = [1300, 650];
const SAVE_KEY = 'dash-derby-save';
const SAVE_VERSION = 2;
const PHASES: Phase[] = ['setup', 'pass', 'bet', 'ready', 'race', 'result', 'final'];

type Phase = 'setup' | 'pass' | 'bet' | 'ready' | 'race' | 'result' | 'final';

interface Player {
  name: string;
  score: number;
  lastPoints: number;
}

interface Game {
  version: number;
  phase: Phase;
  players: Player[];
  raceIndex: number;
  betTurn: number;
  bets: Bet[];
  race: RaceState | null;
  log: string[];
  last: { title: string; detail: string; kind: string } | null;
  speed: number;
}

const app = document.getElementById('app')!;
let game: Game = load() ?? freshGame();
let timer: number | undefined;
let paused = false;
let draftBet: Partial<Bet> = {};

function freshGame(): Game {
  return { version: SAVE_VERSION, phase: 'setup', players: [], raceIndex: 0, betTurn: 0, bets: [], race: null, log: [], last: null, speed: 0 };
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch {
    // 保存できなくても遊べる
  }
}

function load(): Game | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    return isValidSave(g) ? g : null;
  } catch {
    return null;
  }
}

// 古い版や壊れた保存データは読まずにタイトルから始める
function isValidSave(g: Game): boolean {
  if (!g || g.version !== SAVE_VERSION || !PHASES.includes(g.phase) || !Array.isArray(g.players)) return false;
  if (g.phase !== 'setup' && g.players.length < 2) return false;
  const needsBets = ['ready', 'race', 'result'].includes(g.phase);
  if (needsBets && g.bets.length !== g.players.length) return false;
  if ((g.phase === 'race' || g.phase === 'result') && !(g.race && Array.isArray(g.race.racers) && Array.isArray(g.race.deck))) return false;
  return true;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function racerChip(r: number) {
  const x = RACERS[r];
  return `<span class="chip" style="--c:${x.color}">${x.icon} ${x.name}</span>`;
}

function setPhase(phase: Phase) {
  game.phase = phase;
  save();
  render();
}

let renderedAt = 0;

// 画面が切り替わった直後のタップは、前の画面への連打とみなして無視する
app.addEventListener(
  'click',
  (e) => {
    if (performance.now() - renderedAt < 400) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);

function render() {
  stopTimer();
  renderedAt = performance.now();
  try {
    renderPhase();
  } catch (err) {
    console.error(err);
    game = freshGame();
    save();
    renderSetup();
  }
}

function renderPhase() {
  switch (game.phase) {
    case 'setup':
      return renderSetup();
    case 'pass':
      return renderPass();
    case 'bet':
      return renderBet();
    case 'ready':
      return renderReady();
    case 'race':
      return renderRace();
    case 'result':
      return renderResult();
    case 'final':
      return renderFinal();
  }
}

// ---- 準備 ----
function renderSetup() {
  const saved = game.players.length ? game.players.map((p) => p.name) : ['', '', '', ''];
  const count = Math.max(2, game.players.length || 2);
  app.innerHTML = `
    <main class="screen center">
      <h1 class="logo">🏁 ダッシュダービー</h1>
      <p class="lead">4体のレースの1着と2着を当てよう。全${RACE_COUNT}レース、合計点で勝負！</p>
      <section class="panel">
        <h2>人数</h2>
        <div class="seg" id="count">
          ${[2, 3, 4].map((n) => `<button data-n="${n}" class="${n === count ? 'on' : ''}">${n}人</button>`).join('')}
        </div>
        <h2>名前</h2>
        <div id="names">
          ${[0, 1, 2, 3]
            .map((i) => `<input class="name" data-i="${i}" maxlength="8" placeholder="プレイヤー${i + 1}" value="${esc(saved[i] ?? '')}" ${i < count ? '' : 'hidden'} />`)
            .join('')}
        </div>
      </section>
      <section class="panel rules">
        <h2>あそびかた</h2>
        <ol>
          <li>順番に端末を受け取り、こっそり1着と2着を予想する</li>
          <li>レースは自動で進む。カードが1枚ずつめくられ、転んだり逆走したり、ときどき突然のイベントも！</li>
          <li>1着的中 5点・2着的中 3点・両方的中でボーナス +2点。最終レースは2倍</li>
        </ol>
      </section>
      <button class="big" id="start">はじめる</button>
    </main>`;
  let n = count;
  app.querySelectorAll<HTMLButtonElement>('#count button').forEach((b) =>
    b.addEventListener('click', () => {
      n = Number(b.dataset.n);
      app.querySelectorAll('#count button').forEach((x) => x.classList.toggle('on', x === b));
      app.querySelectorAll<HTMLInputElement>('.name').forEach((inp, i) => (inp.hidden = i >= n));
    }),
  );
  app.querySelector('#start')!.addEventListener('click', () => {
    const inputs = [...app.querySelectorAll<HTMLInputElement>('.name')].slice(0, n);
    game = freshGame();
    game.players = inputs.map((inp, i) => ({ name: inp.value.trim() || `プレイヤー${i + 1}`, score: 0, lastPoints: 0 }));
    startBetting();
  });
}

function startBetting() {
  game.betTurn = 0;
  game.bets = [];
  setPhase('pass');
}

// ---- 予想 ----
function renderPass() {
  const p = game.players[game.betTurn];
  app.innerHTML = `
    <main class="screen center">
      <p class="race-no">第${game.raceIndex + 1}レース${game.raceIndex === RACE_COUNT - 1 ? '（得点2倍！）' : ''}</p>
      <h1>${esc(p.name)} さんの番</h1>
      <p class="lead">端末を ${esc(p.name)} さんに渡してください。<br />ほかの人は画面を見ないでね。</p>
      <button class="big" id="go">予想する</button>
      <button class="sub" id="quit">ゲームをやめてタイトルへ</button>
    </main>`;
  app.querySelector('#go')!.addEventListener('click', () => {
    draftBet = {};
    setPhase('bet');
  });
  app.querySelector('#quit')!.addEventListener('click', () => {
    if (!confirm('今のゲームをやめてタイトルに戻りますか？')) return;
    const players = game.players;
    game = freshGame();
    game.players = players;
    setPhase('setup');
  });
}

function renderBet() {
  const p = game.players[game.betTurn];
  const pick = (slot: 'first' | 'second') =>
    RACERS.map((x, r) => {
      const taken = slot === 'second' && draftBet.first === r;
      const on = draftBet[slot] === r;
      return `<button class="pick ${on ? 'on' : ''}" data-slot="${slot}" data-r="${r}" ${taken ? 'disabled' : ''} style="--c:${x.color}">
        <span class="icon">${x.icon}</span>${x.name}</button>`;
    }).join('');
  app.innerHTML = `
    <main class="screen center">
      <h1>${esc(p.name)} さんの予想</h1>
      <section class="panel">
        <h2>🥇 1着</h2><div class="picks">${pick('first')}</div>
        <h2>🥈 2着</h2><div class="picks">${pick('second')}</div>
      </section>
      <button class="big" id="ok" ${draftBet.first !== undefined && draftBet.second !== undefined ? '' : 'disabled'}>決定</button>
    </main>`;
  app.querySelectorAll<HTMLButtonElement>('.pick').forEach((b) =>
    b.addEventListener('click', () => {
      const r = Number(b.dataset.r);
      if (b.dataset.slot === 'first') {
        draftBet.first = r;
        if (draftBet.second === r) delete draftBet.second;
      } else {
        draftBet.second = r;
      }
      renderBet();
    }),
  );
  app.querySelector('#ok')!.addEventListener('click', () => {
    game.bets[game.betTurn] = draftBet as Bet;
    game.betTurn++;
    setPhase(game.betTurn < game.players.length ? 'pass' : 'ready');
  });
}

function renderReady() {
  app.innerHTML = `
    <main class="screen center">
      <p class="race-no">第${game.raceIndex + 1}レース</p>
      <h1>予想が出そろいました</h1>
      <p class="lead">みんなで画面を囲んで、スタート！</p>
      <button class="big" id="go">レース開始</button>
    </main>`;
  app.querySelector('#go')!.addEventListener('click', () => {
    const lanes = shuffle([0, 1, 2, 3], Math.random);
    game.race = newRace(buildDeck(Math.random), lanes);
    game.log = ['よーい…スタート！'];
    game.last = null;
    paused = false;
    setPhase('race');
  });
}

// ---- レース ----
function renderRace() {
  const race = game.race!;
  const cols = FINISH + 1;
  const cells = Array.from({ length: LANE_COUNT }, (_, lane) =>
    Array.from(
      { length: cols },
      (_, c) => `<div class="cell ${STARS.includes(c) ? 'star' : ''} ${c === FINISH ? 'goal' : ''} ${c === 0 ? 'start' : ''}" style="grid-row:${lane + 1};grid-column:${c + 1}"></div>`,
    ).join(''),
  ).join('');
  app.innerHTML = `
    <main class="screen race">
      <header class="race-head">
        <span class="race-no">第${game.raceIndex + 1}レース${game.raceIndex === RACE_COUNT - 1 ? ' ×2' : ''}</span>
        <span id="deck" class="deck"></span>
        <div class="ctrl">
          <button id="speed"></button>
          <button id="pause"></button>
        </div>
      </header>
      <section id="card" class="card"></section>
      <section class="track-wrap">
        <div class="track" id="track" style="--cols:${cols};--lanes:${LANE_COUNT}">
          ${cells}
          ${RACERS.map((x, r) => `<div class="token" id="t${r}" style="--c:${x.color}"><span class="face">${x.icon}</span><span class="badge"></span></div>`).join('')}
        </div>
      </section>
      <section class="bottom">
        <ul id="log" class="log"></ul>
        <ul class="bets">
          ${game.players
            .map((p, i) => `<li><b>${esc(p.name)}</b> 🥇${RACERS[game.bets[i].first].icon} 🥈${RACERS[game.bets[i].second].icon}</li>`)
            .join('')}
        </ul>
      </section>
      <button class="big" id="next" hidden>結果を見る</button>
    </main>`;
  app.querySelector('#pause')!.addEventListener('click', () => {
    paused = !paused;
    updateRace();
    if (!paused) schedule();
  });
  app.querySelector('#speed')!.addEventListener('click', () => {
    game.speed = (game.speed + 1) % STEP_MS.length;
    save();
    updateRace();
  });
  app.querySelector('#next')!.addEventListener('click', finishRace);
  updateRace();
  schedule();
}

function updateRace() {
  const race = game.race!;
  const track = document.getElementById('track');
  if (!track) return;
  // 同じマスにいるコマは少しずつずらして重ならないようにする
  const cellOf = (i: number) => {
    const r = race.racers[i];
    return `${Math.max(0, Math.min(FINISH, r.pos))}:${Math.max(0, Math.min(LANE_COUNT - 1, r.lane))}`;
  };
  race.racers.forEach((r, i) => {
    const t = document.getElementById(`t${i}`)!;
    const mates = race.racers.map((_, j) => j).filter((j) => cellOf(j) === cellOf(i));
    const k = mates.indexOf(i);
    const shift = mates.length > 1 ? String((k - (mates.length - 1) / 2) * 0.3) : '0';
    t.style.setProperty('--dx', shift);
    t.style.setProperty('--dy', shift);
    t.classList.toggle('crowded', mates.length > 1);
    t.style.setProperty('--x', String(Math.max(0, Math.min(FINISH, r.pos))));
    t.style.setProperty('--y', String(Math.max(0, Math.min(LANE_COUNT - 1, r.lane))));
    t.classList.toggle('fallen', r.fallen);
    t.classList.toggle('back', r.facing === -1);
    t.classList.toggle('dq', r.status === 'dq');
    t.querySelector('.badge')!.textContent = r.status === 'dq' ? '失格' : r.place ? `${r.place}着` : '';
  });
  document.getElementById('deck')!.textContent = `山札 ${race.deck.length}枚${race.lastSpurt ? '・ラストスパート' : ''}`;
  document.getElementById('speed')!.textContent = game.speed ? '⏩ 速い' : '▶️ ふつう';
  const pause = document.getElementById('pause')!;
  pause.textContent = paused ? '▶️ 再開' : '⏸ 一時停止';
  pause.hidden = race.over;
  const card = document.getElementById('card')!;
  card.className = `card ${game.last?.kind ?? ''}`;
  // カードが替わるたびにめくる演出をやり直す
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
  card.innerHTML = game.last ? `<div class="title">${game.last.title}</div><div class="detail">${game.last.detail}</div>` : `<div class="title">3…2…1…</div>`;
  document.getElementById('log')!.innerHTML = game.log
    .slice(-4)
    .reverse()
    .map((l) => `<li>${l}</li>`)
    .join('');
  (document.getElementById('next') as HTMLButtonElement).hidden = !race.over;
}

function schedule() {
  stopTimer();
  if (paused || game.race!.over) return;
  timer = window.setTimeout(tick, game.last ? STEP_MS[game.speed] : 1500);
}

function stopTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function tick() {
  const race = game.race!;
  const turn: Turn = drawNext(race, NAMES, Math.random);
  if (turn.event) {
    game.last = { title: `⚡ ${EVENT_TITLES[turn.event]}`, detail: turn.log[0] ?? '', kind: 'event' };
  } else if (turn.card) {
    const r = turn.card.kind === 'all' ? -1 : turn.card.racer;
    game.last = { title: r >= 0 ? RACERS[r].icon : '🏃', detail: describeCard(turn.card, NAMES), kind: `card k-${turn.card.kind}` };
  } else if (turn.log.length) {
    game.last = { title: '🏁', detail: turn.log[0], kind: 'card' };
  }
  game.log.push(...turn.log);
  if (race.over) game.log.push('レース終了！');
  save();
  updateRace();
  schedule();
}

function finishRace() {
  const places = game.race!.places;
  game.players.forEach((p, i) => {
    p.lastPoints = scoreBet(game.bets[i], places, game.raceIndex);
    p.score += p.lastPoints;
  });
  setPhase('result');
}

// ---- 結果 ----
function renderResult() {
  const places = game.race!.places;
  const last = game.raceIndex === RACE_COUNT - 1;
  app.innerHTML = `
    <main class="screen center">
      <h1>第${game.raceIndex + 1}レース 結果</h1>
      <ol class="podium">
        ${places.map((r, i) => `<li><span class="place">${i + 1}着</span>${racerChip(r!)}${game.race!.racers[r!].status === 'dq' ? '<span class="dq">失格</span>' : ''}</li>`).join('')}
      </ol>
      <table class="score">
        <tr><th>プレイヤー</th><th>予想</th><th>今回</th><th>合計</th></tr>
        ${game.players
          .map(
            (p, i) => `<tr><td>${esc(p.name)}</td><td>🥇${RACERS[game.bets[i].first].icon} 🥈${RACERS[game.bets[i].second].icon}</td>
            <td class="${p.lastPoints ? 'plus' : ''}">+${p.lastPoints}</td><td>${p.score}</td></tr>`,
          )
          .join('')}
      </table>
      <button class="big" id="next">${last ? '最終結果へ' : '次のレースへ'}</button>
    </main>`;
  app.querySelector('#next')!.addEventListener('click', () => {
    if (last) return setPhase('final');
    game.raceIndex++;
    startBetting();
  });
}

function renderFinal() {
  const ranked = game.players.map((p) => p).sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  const winners = ranked.filter((p) => p.score === top);
  app.innerHTML = `
    <main class="screen center">
      <p class="race-no">最終結果</p>
      <h1>🏆 ${winners.map((w) => esc(w.name)).join('・')} さん${winners.length > 1 ? 'が同点優勝！' : 'の優勝！'}</h1>
      <table class="score">
        <tr><th>順位</th><th>プレイヤー</th><th>得点</th></tr>
        ${ranked.map((p) => `<tr><td>${ranked.findIndex((q) => q.score === p.score) + 1}位</td><td>${esc(p.name)}</td><td>${p.score}</td></tr>`).join('')}
      </table>
      <button class="big" id="again">同じメンバーでもう一度</button>
      <button class="sub" id="reset">メンバーを変える</button>
    </main>`;
  app.querySelector('#again')!.addEventListener('click', () => {
    const names = game.players.map((p) => p.name);
    game = freshGame();
    game.players = names.map((name) => ({ name, score: 0, lastPoints: 0 }));
    startBetting();
  });
  app.querySelector('#reset')!.addEventListener('click', () => {
    const players = game.players;
    game = freshGame();
    game.players = players;
    setPhase('setup');
  });
}

// レース途中で再読み込みした場合は一時停止から再開する
if (game.phase === 'race') paused = true;
render();
