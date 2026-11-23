// 輪 — MCP サーバー（Claude がデータを読み、了承を得てから書き込むための道具）
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { LAYERS, LAYER_IDS, uid, clamp, today, expFor, levelOf } = require('./store');

const WRITE_NOTE = '書き込み系の道具。ユーザーが提案をはっきり了承した後にだけ呼ぶこと。';
const layerEnum = z.enum(LAYER_IDS).describe('層: physical=体, brain=脳, mind=心, soul=魂');
const text = obj => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = msg => ({ isError: true, content: [{ type: 'text', text: msg }] });

function lastDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  });
}

function summary(s, days) {
  const lv = levelOf(s.exp);
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const range = lastDays(days);
  return {
    today: today(),
    player: s.player,
    level: lv, exp: s.exp, exp_to_next: expFor(lv + 1) - s.exp,
    layers: LAYERS.map(L => {
      const st = s.stats.filter(x => x.layer === L.id);
      return { id: L.id, name: `${L.en} ${L.ja}`, value_avg: avg(st.map(x => x.value)), target_avg: avg(st.map(x => x.target)) };
    }),
    stats: s.stats.map(x => ({
      id: x.id, layer: x.layer, name: x.name, sub: x.sub, value: x.value, target: x.target, gap: x.target - x.value, goal: x.goal,
      recent: Object.fromEntries(range.filter(d => x.log?.[d] != null).map(d => [d, x.log[d]])),
    })),
    quests: s.quests.map(q => ({
      id: q.id, title: q.title, layer: q.layer, stat_id: q.stat, exp: q.exp, boost: q.boost, note: q.note, done: q.done, done_at: q.doneAt,
    })),
  };
}

function findStat(s, id) { return s.stats.find(x => x.id === id); }
function findQuest(s, id) { return s.quests.find(x => x.id === id); }

function createMcpServer(store) {
  const server = new McpServer(
    { name: 'wa', title: '輪 — 体・脳・心・魂', version: '1.0.0' },
    { instructions:
      '輪はユーザー本人が自分を育てるための記録。項目（stats）は 0〜100 の値と目標値、伸ばしたいこと（goal）を持ち、' +
      'クエスト（quests）は達成すると EXP と、つないだ項目の値が上がる。' +
      'まず wa_get_status で状態を読み、提案は会話の中で理由と一緒に示す。' +
      '書き込み系の道具は、ユーザーが了承した内容だけを呼ぶ。判断するのはユーザー本人。' }
  );

  server.registerTool('wa_get_status', {
    title: '輪の状態を読む',
    description: 'プレイヤー、LV/EXP、各層の平均、全項目（値・目標・差・伸ばしたいこと・直近の記録）、全クエストを返す。提案の前に必ず読む。',
    inputSchema: { days: z.number().int().min(1).max(90).optional().describe('直近何日分の記録を含めるか（既定 14）') },
    annotations: { readOnlyHint: true },
  }, async ({ days }) => text(summary(await store.read(), days ?? 14)));

  server.registerTool('wa_add_stat', {
    title: '項目を追加',
    description: `新しい項目を追加する。${WRITE_NOTE}`,
    inputSchema: {
      layer: layerEnum,
      name: z.string().min(1).max(24).describe('表示名（例: NETWORK）'),
      sub: z.string().max(24).optional().describe('よみ・メモ（例: ネットワーク）'),
      target: z.number().min(0).max(100).optional().describe('目標値（既定 60）'),
      goal: z.string().max(600).optional().describe('伸ばしたいこと・目標'),
    },
  }, async a => text(await store.mutate(s => {
    const st = { id: uid(), layer: a.layer, name: a.name, sub: a.sub ?? '', value: 0, target: clamp(a.target ?? 60), goal: a.goal ?? '', log: {} };
    s.stats.push(st); return { added: st };
  })));

  server.registerTool('wa_update_stat', {
    title: '項目を編集',
    description: `項目の名前・層・目標値・伸ばしたいことを変える。渡した欄だけ変わる。${WRITE_NOTE}`,
    inputSchema: {
      id: z.string(), layer: layerEnum.optional(),
      name: z.string().min(1).max(24).optional(), sub: z.string().max(24).optional(),
      target: z.number().min(0).max(100).optional(), goal: z.string().max(600).optional(),
    },
  }, async ({ id, ...a }) => {
    let res;
    await store.mutate(s => {
      const st = findStat(s, id); if (!st) return;
      for (const k of ['layer', 'name', 'sub', 'goal']) if (a[k] !== undefined) st[k] = a[k];
      if (a.target !== undefined) st.target = clamp(a.target);
      res = st;
    });
    return res ? text({ updated: res }) : fail(`項目 ${id} が見つからない`);
  });

  server.registerTool('wa_record_value', {
    title: '値を記録',
    description: `項目の今の値（0〜100）を記録する。ユーザーが自分の状態を言ったときに使う。${WRITE_NOTE}`,
    inputSchema: {
      id: z.string(), value: z.number().min(0).max(100),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD（既定は今日）'),
    },
  }, async ({ id, value, date }) => {
    let res;
    await store.mutate(s => {
      const st = findStat(s, id); if (!st) return;
      const d = date ?? today(); (st.log ??= {})[d] = clamp(value);
      if (d >= (Object.keys(st.log).sort().pop() ?? d)) st.value = clamp(value);
      res = { id, name: st.name, date: d, value: clamp(value) };
    });
    return res ? text({ recorded: res }) : fail(`項目 ${id} が見つからない`);
  });

  server.registerTool('wa_delete_stat', {
    title: '項目を削除',
    description: `項目と、その記録をすべて消す。取り消せない。${WRITE_NOTE}`,
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    let res;
    await store.mutate(s => {
      const st = findStat(s, id); if (!st) return;
      s.stats = s.stats.filter(x => x !== st);
      s.quests.forEach(q => { if (q.stat === id) q.stat = null; });
      res = st.name;
    });
    return res ? text(`「${res}」を削除した`) : fail(`項目 ${id} が見つからない`);
  });

  server.registerTool('wa_add_quest', {
    title: 'クエストを追加',
    description: `やりたいことをクエストとして追加する。${WRITE_NOTE}`,
    inputSchema: {
      title: z.string().min(1).max(80), layer: layerEnum,
      stat_id: z.string().optional().describe('達成で伸びる項目の id'),
      exp: z.number().int().min(0).max(1000).optional().describe('獲得 EXP（既定 30）'),
      boost: z.number().int().min(0).max(20).optional().describe('項目の上昇値（既定 3）'),
      note: z.string().max(600).optional(),
    },
  }, async a => {
    let res;
    await store.mutate(s => {
      if (a.stat_id && !findStat(s, a.stat_id)) return;
      res = { id: uid(), title: a.title, layer: a.layer, stat: a.stat_id ?? null, exp: a.exp ?? 30, boost: a.boost ?? 3, note: a.note ?? '', done: false, doneAt: null };
      s.quests.push(res);
    });
    return res ? text({ added: res }) : fail(`項目 ${a.stat_id} が見つからない`);
  });

  server.registerTool('wa_update_quest', {
    title: 'クエストを編集',
    description: `クエストの内容を変える。渡した欄だけ変わる。達成済みでも EXP は付け直さない。${WRITE_NOTE}`,
    inputSchema: {
      id: z.string(), title: z.string().min(1).max(80).optional(), layer: layerEnum.optional(),
      stat_id: z.string().nullable().optional(), exp: z.number().int().min(0).max(1000).optional(),
      boost: z.number().int().min(0).max(20).optional(), note: z.string().max(600).optional(),
    },
  }, async ({ id, stat_id, ...a }) => {
    let res, err;
    await store.mutate(s => {
      const q = findQuest(s, id); if (!q) { err = `クエスト ${id} が見つからない`; return; }
      if (stat_id && !findStat(s, stat_id)) { err = `項目 ${stat_id} が見つからない`; return; }
      for (const k of ['title', 'layer', 'exp', 'boost', 'note']) if (a[k] !== undefined) q[k] = a[k];
      if (stat_id !== undefined) q.stat = stat_id;
      res = q;
    });
    return err ? fail(err) : text({ updated: res });
  });

  server.registerTool('wa_set_quest_done', {
    title: 'クエストの達成を切り替える',
    description: `達成にすると EXP と項目の値が上がり、未達成に戻すと元に戻る。${WRITE_NOTE}`,
    inputSchema: { id: z.string(), done: z.boolean() },
  }, async ({ id, done }) => {
    let res;
    await store.mutate(s => {
      const q = findQuest(s, id); if (!q) return;
      if (!!q.done === done) { res = { unchanged: true, title: q.title, done }; return; }
      const before = levelOf(s.exp), sign = done ? 1 : -1, st = findStat(s, q.stat);
      q.done = done; q.doneAt = done ? today() : null;
      s.exp = Math.max(0, s.exp + sign * (q.exp || 0));
      if (st && q.boost) { st.value = clamp(st.value + sign * q.boost); (st.log ??= {})[today()] = st.value; }
      res = { title: q.title, done, exp: s.exp, level: levelOf(s.exp), level_up: levelOf(s.exp) > before, stat: st ? { name: st.name, value: st.value } : null };
    });
    return res ? text(res) : fail(`クエスト ${id} が見つからない`);
  });

  server.registerTool('wa_delete_quest', {
    title: 'クエストを削除',
    description: `クエストを消す。達成済みでも獲得した EXP はそのまま残る。${WRITE_NOTE}`,
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    let res;
    await store.mutate(s => { const q = findQuest(s, id); if (!q) return; s.quests = s.quests.filter(x => x !== q); res = q.title; });
    return res ? text(`「${res}」を削除した`) : fail(`クエスト ${id} が見つからない`);
  });

  server.registerPrompt('review', {
    title: '輪をふりかえる',
    description: '今の状態を読んで、次に伸ばすことやクエストを提案してもらう',
    argsSchema: { focus: z.string().optional().describe('特に相談したいこと（任意）') },
  }, ({ focus }) => ({
    messages: [{ role: 'user', content: { type: 'text', text:
      'wa_get_status で輪の状態を読んで、ふりかえりをしてほしい。\n' +
      '- 目標との差が大きい項目、最近記録が止まっている項目、伸びている項目を見つける\n' +
      '- 次にやるとよいクエストを 3 つまで、理由と一緒に提案する（EXP と伸びる項目も）\n' +
      '- 目標値や項目そのものを見直したほうがよければ、それも提案する\n' +
      '- 書き込みはまだしない。僕が選んだものだけ反映すること' +
      (focus ? `\n\n特に相談したいこと: ${focus}` : '') } }],
  }));

  return server;
}

module.exports = { createMcpServer };
