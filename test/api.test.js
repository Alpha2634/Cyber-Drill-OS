'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { BY_ID } = require('../data/scenarios');
const { computeScore } = require('../lib/scoring');

async function setup(extra = {}) {
  const clock = { t: 1_000_000 };
  const app = createApp({ dataFile: null, silent: true, now: () => clock.t, publicDir: '/nonexistent', ...extra });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  const register = async (name) => (await call('POST', '/api/users', { body: { username: name } })).json.token;
  return { app, clock, call, register, close: () => app.close() };
}

const optionWith = (round, quality) => {
  const sc = BY_ID[round.scenario.id];
  const opt = sc.options.find((o) => o.quality === quality);
  return opt.id;
};

test('health + config + scenario list never leak answers', async () => {
  const t = await setup();
  assert.equal((await t.call('GET', '/api/health')).json.status, 'ok');
  assert.equal((await t.call('GET', '/api/config')).json.roundDurationMs, 60000);
  const list = (await t.call('GET', '/api/scenarios?mode=soc')).json.scenarios;
  assert.ok(list.length >= 5);
  assert.ok(!JSON.stringify(list).includes('quality'));
  await t.close();
});

test('registration validation and auth', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', '/api/users', { body: { username: '<b>' } })).status, 400);
  assert.equal((await t.call('POST', '/api/users', { body: { username: 'Fatima' } })).status, 201);
  assert.equal((await t.call('POST', '/api/users', { body: { username: 'fatima' } })).status, 409);
  assert.equal((await t.call('GET', '/api/me')).status, 401);
  assert.equal((await t.call('POST', '/api/rounds', { body: {} })).status, 401);
  await t.close();
});

test('round payload hides quality; best answer scores with time bonus', async () => {
  const t = await setup();
  const token = await t.register('Alice');
  const r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'soc', scenarioId: 'ssh-bruteforce' } })).json;
  assert.equal(r.options.length, 4);
  assert.ok(!JSON.stringify(r).includes('quality'));
  assert.ok(!JSON.stringify(r).includes('"why"'));
  assert.equal(r.durationMs, 60000);

  t.clock.t += 10_000; // 10s elapsed -> 50s remaining
  const res = (await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, 'best') } })).json;
  assert.equal(res.verdict, 'correct');
  assert.equal(res.score.base, 100);
  assert.equal(res.score.timeBonus, Math.floor(50 * (50000 / 60000)));
  assert.equal(res.score.difficultyMultiplier, 1.25);
  assert.equal(res.score.total, Math.round((100 + 41) * 1.25));
  assert.equal(res.isNewHiScore, true);
  assert.equal(res.feedback.source, 'static');
  assert.ok(res.newBadges.some((b) => b.code === 'first_round'));
  assert.equal(res.review.length, 4);

  // double submit blocked
  const again = await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: 'a' } });
  assert.equal(again.status, 409);
  await t.close();
});

test('dangerous option scores 0 and resets streak; streak multiplier applies', async () => {
  const t = await setup();
  const token = await t.register('Bob');
  const play = async (quality) => {
    const r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'beginner', scenarioId: 'phish-payroll' } })).json;
    t.clock.t += 60_000 - 1; // ~0 time bonus to keep numbers simple
    return (await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, quality) } })).json;
  };
  const a = await play('best');   // streak 0 -> x1.0
  const b = await play('best');   // streak 1 -> x1.1
  assert.equal(a.score.total, 100);
  assert.equal(b.score.total, 110);
  const c = await play('dangerous');
  assert.equal(c.score.total, 0);
  assert.equal(c.user.streak, 0);
  const me = (await t.call('GET', '/api/me', { token })).json;
  assert.equal(me.roundsPlayed, 3);
  assert.equal(me.bestStreak, 2);
  assert.equal(me.totalScore, 210);
  assert.equal(me.categories[0].category, 'Phishing');
  await t.close();
});

test('hints cost points; second hint eliminates a wrong option; capped at 2', async () => {
  const t = await setup();
  const token = await t.register('Carol');
  const r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'employee', scenarioId: 'bec-wire' } })).json;
  const h1 = (await t.call('POST', `/api/rounds/${r.roundId}/hint`, { token })).json;
  assert.equal(h1.hint.type, 'text'); assert.equal(h1.penalty, 15);
  const h2 = (await t.call('POST', `/api/rounds/${r.roundId}/hint`, { token })).json;
  assert.equal(h2.hint.type, 'eliminate');
  assert.equal(BY_ID['bec-wire'].options.find((o) => o.id === h2.hint.optionId).quality, 'dangerous');
  assert.equal((await t.call('POST', `/api/rounds/${r.roundId}/hint`, { token })).status, 409);

  // resuming shows the revealed hints
  const view = (await t.call('GET', `/api/rounds/${r.roundId}`, { token })).json;
  assert.equal(view.hintsUsed, 2); assert.equal(view.eliminated.length, 1);

  t.clock.t += 60_000;
  const res = (await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, 'best') } })).json;
  assert.equal(res.score.hintPenalty, 40);
  assert.equal(res.score.total, Math.round((100 - 40) * 1.25));
  await t.close();
});

test('timeout: late answer is rejected as timed out; empty answer allowed only after expiry', async () => {
  const t = await setup();
  const token = await t.register('Dan');
  const r1 = (await t.call('POST', '/api/rounds', { token, body: { mode: 'beginner', scenarioId: 'usb-parking-lot' } })).json;
  const early = await t.call('POST', `/api/rounds/${r1.roundId}/decision`, { token, body: {} });
  assert.equal(early.status, 400);
  t.clock.t += 62_000; // beyond 60s + 1.5s grace
  const late = (await t.call('POST', `/api/rounds/${r1.roundId}/decision`, { token, body: { optionId: optionWith(r1, 'best') } })).json;
  assert.equal(late.timedOut, true);
  assert.equal(late.score.total, 0);
  assert.equal(late.chosen !== null, true); // we still report what they picked
  assert.equal(late.best.id, BY_ID['usb-parking-lot'].options.find((o) => o.quality === 'best').id);

  const r2 = (await t.call('POST', '/api/rounds', { token, body: { mode: 'beginner', scenarioId: 'usb-parking-lot' } })).json;
  t.clock.t += 60_000;
  const none = (await t.call('POST', `/api/rounds/${r2.roundId}/decision`, { token, body: {} })).json;
  assert.equal(none.timedOut, true);
  assert.equal(none.chosen, null);
  assert.equal((await t.call('GET', '/api/me', { token })).json.timeouts, 2);
  await t.close();
});

test('rounds are private to their owner; bad options rejected', async () => {
  const t = await setup();
  const a = await t.register('Eve');
  const b = await t.register('Mallory');
  const r = (await t.call('POST', '/api/rounds', { token: a, body: { mode: 'soc' } })).json;
  assert.equal((await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token: b, body: { optionId: 'a' } })).status, 403);
  assert.equal((await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token: a, body: { optionId: 'zzz' } })).status, 400);
  assert.equal((await t.call('POST', '/api/rounds', { token: a, body: { mode: 'nope' } })).status, 400);
  assert.equal((await t.call('POST', '/api/rounds', { token: a, body: { mode: 'soc', scenarioId: 'cafe-wifi' } })).status, 400);
  await t.close();
});

test('adaptive picker avoids recent scenarios and leaderboard ranks players', async () => {
  const t = await setup();
  const token = await t.register('Frank');
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'soc' } })).json;
    seen.push(r.scenario.id);
    t.clock.t += 5000;
    await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, 'best') } });
  }
  assert.equal(new Set(seen).size, 4, 'no repeats within the recent window');

  const g = await t.register('Grace');
  const r = (await t.call('POST', '/api/rounds', { token: g, body: { mode: 'beginner', scenarioId: 'cafe-wifi' } })).json;
  await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token: g, body: { optionId: optionWith(r, 'poor') } });

  const lb = (await t.call('GET', '/api/leaderboard')).json.entries;
  assert.equal(lb[0].username, 'Frank');
  assert.equal(lb[1].username, 'Grace');
  assert.equal(lb[0].position, 1);
  await t.close();
});

test('valid AI feedback is used; invalid AI feedback falls back to static', async () => {
  const good = JSON.stringify({ verdict: 'correct', explanation: 'Isolating the host stops the attacker while keeping evidence intact for forensics.', lesson: 'Contain first, then investigate.', tip: 'Keep logs.' });
  let t = await setup({ aiComplete: async () => good });
  let token = await t.register('Hal');
  let r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'soc', scenarioId: 'ssh-bruteforce' } })).json;
  let res = (await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, 'best') } })).json;
  assert.equal(res.feedback.source, 'ai');
  await t.close();

  // model lies about the verdict (says correct on a dangerous choice)
  t = await setup({ aiComplete: async () => good });
  token = await t.register('Ivy');
  r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'soc', scenarioId: 'ssh-bruteforce' } })).json;
  res = (await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, 'dangerous') } })).json;
  assert.equal(res.feedback.source, 'static');
  assert.equal(res.verdict, 'incorrect');
  await t.close();

  // model throws
  t = await setup({ aiComplete: async () => { throw new Error('boom'); } });
  token = await t.register('Jay');
  r = (await t.call('POST', '/api/rounds', { token, body: { mode: 'soc', scenarioId: 'ssh-bruteforce' } })).json;
  res = (await t.call('POST', `/api/rounds/${r.roundId}/decision`, { token, body: { optionId: optionWith(r, 'best') } })).json;
  assert.equal(res.feedback.source, 'static');
  await t.close();
});

test('computeScore caps streak bonus at +50% and never goes negative', () => {
  const s = computeScore({ quality: 'best', remainingMs: 0, hintsUsed: 0, difficulty: 3, streakBefore: 20 });
  assert.equal(s.total, Math.round(100 * 1.5 * 1.5));
  const z = computeScore({ quality: 'poor', remainingMs: 60000, hintsUsed: 2, difficulty: 1, streakBefore: 0 });
  assert.equal(z.total, 0);
});

test('every scenario has 4 options with exactly one best and unique ids', () => {
  for (const s of Object.values(BY_ID)) {
    assert.equal(s.options.length, 4, s.id);
    assert.equal(s.options.filter((o) => o.quality === 'best').length, 1, s.id);
    assert.ok(s.options.some((o) => o.quality === 'dangerous'), `${s.id} needs a dangerous option for hint 2`);
    assert.equal(new Set(s.options.map((o) => o.id)).size, 4, s.id);
  }
});
