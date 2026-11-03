// オリジナルのレーサー4体。すべて右向き（進行方向）で描き、逆走は左右反転で表す。

export interface RacerInfo {
  name: string;
  color: string;
  svg: string;
}

const legs = (color: string) => `
  <g class="legs" stroke="${color}" stroke-width="5" stroke-linecap="round">
    <line class="leg a" x1="26" y1="50" x2="22" y2="60" />
    <line class="leg b" x1="38" y1="50" x2="42" y2="60" />
  </g>`;

const bib = (n: number, color: string) => `
  <g class="bib">
    <rect x="22" y="30" width="14" height="12" rx="2" fill="#fff" stroke="${color}" stroke-width="2" />
    <text x="29" y="40" font-size="10" font-weight="900" text-anchor="middle" fill="${color}">${n}</text>
  </g>`;

const svg = (body: string) =>
  `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const RACERS: RacerInfo[] = [
  {
    name: 'ペンタ',
    color: '#3a86ff',
    svg: svg(`
      ${legs('#f8961e')}
      <ellipse cx="30" cy="34" rx="17" ry="19" fill="#22313f" />
      <ellipse cx="36" cy="37" rx="10" ry="14" fill="#f8f9fa" />
      <path d="M14 30 Q6 38 12 46" stroke="#22313f" stroke-width="6" fill="none" stroke-linecap="round" />
      <circle cx="38" cy="22" r="3.2" fill="#fff" /><circle cx="39.2" cy="22" r="1.7" fill="#111" />
      <path d="M45 24 L56 27 L45 30 Z" fill="#f8961e" />
      <path d="M17 18 Q30 10 43 16" stroke="#3a86ff" stroke-width="5" fill="none" stroke-linecap="round" />
      ${bib(1, '#3a86ff')}`),
  },
  {
    name: 'ケロ',
    color: '#2a9d8f',
    svg: svg(`
      ${legs('#2d6a4f')}
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="#52b788" />
      <ellipse cx="34" cy="42" rx="12" ry="7" fill="#d8f3dc" />
      <circle cx="40" cy="22" r="8" fill="#52b788" />
      <circle cx="42" cy="21" r="4.5" fill="#fff" /><circle cx="43.5" cy="21" r="2.3" fill="#111" />
      <path d="M38 33 Q46 36 51 31" stroke="#1b4332" stroke-width="2" fill="none" stroke-linecap="round" />
      <circle cx="47" cy="31" r="1.2" fill="#e76f8a" />
      ${bib(2, '#2a9d8f')}`),
  },
  {
    name: 'ミケ',
    color: '#f4a261',
    svg: svg(`
      ${legs('#e76f51')}
      <path d="M12 36 Q2 26 8 14" stroke="#f4a261" stroke-width="5" fill="none" stroke-linecap="round" />
      <ellipse cx="28" cy="38" rx="17" ry="12" fill="#f4a261" />
      <circle cx="42" cy="25" r="11" fill="#f4a261" />
      <path d="M34 17 L35 6 L42 14 Z M44 14 L50 6 L51 18 Z" fill="#f4a261" />
      <path d="M36 15 L37 10 L40 14 Z" fill="#e76f8a" />
      <circle cx="46" cy="24" r="2.2" fill="#111" />
      <circle cx="52.5" cy="28" r="1.6" fill="#e76f8a" />
      <path d="M50 31 L58 30 M50 33 L58 34" stroke="#6b4f2a" stroke-width="1" />
      <path d="M22 30 Q26 34 22 40 M30 28 Q33 33 30 38" stroke="#e76f51" stroke-width="2.5" fill="none" />
      ${bib(3, '#e07a3f')}`),
  },
  {
    name: 'ラビ',
    color: '#e76f8a',
    svg: svg(`
      ${legs('#e76f8a')}
      <circle cx="12" cy="38" r="5" fill="#fff" stroke="#f1c0cb" stroke-width="1.5" />
      <ellipse cx="28" cy="38" rx="16" ry="12" fill="#fde2e8" />
      <circle cx="41" cy="27" r="10" fill="#fde2e8" />
      <ellipse cx="36" cy="10" rx="3.5" ry="11" fill="#fde2e8" transform="rotate(-18 36 10)" />
      <ellipse cx="36" cy="10" rx="1.6" ry="8" fill="#f7a1b5" transform="rotate(-18 36 10)" />
      <ellipse cx="43" cy="9" rx="3.5" ry="11" fill="#fde2e8" transform="rotate(8 43 9)" />
      <ellipse cx="43" cy="9" rx="1.6" ry="8" fill="#f7a1b5" transform="rotate(8 43 9)" />
      <circle cx="45" cy="25" r="2.2" fill="#111" />
      <circle cx="50.5" cy="29" r="1.6" fill="#e76f8a" />
      ${bib(4, '#e76f8a')}`),
  },
];

export const NAMES = RACERS.map((r) => r.name);
