// 輪 — データの読み書き（画面の API と MCP の両方がここを通る）
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const LAYERS = [
  { id: 'physical', en: 'PHYSICAL', ja: '体' },
  { id: 'brain', en: 'BRAIN', ja: '脳' },
  { id: 'mind', en: 'MIND', ja: '心' },
  { id: 'soul', en: 'SOUL', ja: '魂' },
];
const LAYER_IDS = LAYERS.map(l => l.id);

const SEED = [
  ['physical', 'SKIN', '肌'], ['physical', 'EYE', '目'], ['physical', 'NOSE', '鼻'], ['physical', 'WEIGHT', '体重'], ['physical', 'SLEEP', '睡眠'],
  ['brain', 'FOCUS', '集中'], ['brain', 'LEARN', '学び'], ['brain', 'READ', '読書'], ['brain', 'CREATE', '創造'],
  ['mind', 'MOOD', '気分'], ['mind', 'CALM', '平静'], ['mind', 'DRIVE', '意欲'], ['mind', 'BOND', 'つながり'],
  ['soul', 'WILL', '意志'], ['soul', 'FREE', '自由'], ['soul', 'BORDER', '境界線'], ['soul', 'MEANING', '意味'],
];

const uid = () => crypto.randomBytes(5).toString('hex');
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));
const today = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
// LV n に必要な累計 EXP = 50·n·(n-1)（画面側と同じ式）
const expFor = lv => 50 * lv * (lv - 1);
const levelOf = exp => { let lv = 1; while (expFor(lv + 1) <= exp) lv++; return lv; };

function fresh() {
  return {
    version: 1, rev: 0,
    player: { name: 'LUCIFER', title: '自分の頭で考え、自分の意志で選ぶ者' },
    exp: 0,
    stats: SEED.map(([layer, name, sub]) => ({ id: uid(), layer, name, sub, value: 0, target: 60, goal: '', log: {} })),
    quests: [],
  };
}

function normalize(s) {
  s.version ??= 1; s.rev = Number(s.rev) || 0; s.exp = Number(s.exp) || 0;
  s.player ??= fresh().player; s.stats ??= []; s.quests ??= [];
  return s;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'state.json');
    this.queue = Promise.resolve();
  }
  async read() {
    try { return normalize(JSON.parse(await fsp.readFile(this.file, 'utf8'))); }
    catch (e) { if (e.code === 'ENOENT') return fresh(); throw e; }
  }
  async #write(s) {
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(s));
    await fsp.rename(tmp, this.file);
  }
  // 書き込みは一本の列に並べて、同時に来ても順番に処理する
  #serial(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }
  // fn(state) が state を書き換える。戻り値はそのまま返す
  mutate(fn) {
    return this.#serial(async () => {
      const s = await this.read();
      const out = await fn(s);
      s.rev += 1;
      await this.#write(s);
      return out;
    });
  }
  // 画面からの丸ごと保存。baseRev が古ければ衝突として拒否する
  replace(next, baseRev) {
    return this.#serial(async () => {
      const cur = await this.read();
      if (Number(baseRev) !== cur.rev) return { conflict: true, state: cur };
      const s = normalize(next); s.rev = cur.rev + 1;
      await this.#write(s);
      return { conflict: false, rev: s.rev };
    });
  }
}

module.exports = { Store, LAYERS, LAYER_IDS, uid, clamp, today, expFor, levelOf };
