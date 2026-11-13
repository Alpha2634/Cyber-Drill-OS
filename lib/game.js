'use strict';
const { SCENARIOS, MODES, BY_ID } = require('../data/scenarios');
const { ROUND_MS, GRACE_MS, MAX_HINTS, HINT_PENALTY, computeScore, rankFor } = require('./scoring');
const { generateFeedback } = require('./ai');
const { id, shuffle, weightedPick, HttpError } = require('./util');

const RECENT_WINDOW = 5;

/* ---------- user helpers ---------- */

function newUser(username, token) {
  return {
    id: id('usr'), username, token, createdAt: Date.now(),
    totalScore: 0, bestScore: 0, roundsPlayed: 0, correctCount: 0, timeouts: 0,
    streak: 0, bestStreak: 0, totalResponseMs: 0, respondedRounds: 0,
    badges: [], categoryStats: {}, history: [], activeRoundId: null,
  };
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, rank: rankFor(u.totalScore),
    totalScore: u.totalScore, bestScore: u.bestScore, roundsPlayed: u.roundsPlayed,
    streak: u.streak, bestStreak: u.bestStreak, badges: u.badges,
  };
}

function progressView(u) {
  const stats = Object.entries(u.categoryStats).map(([category, s]) => ({
    category, ...s, accuracy: s.played ? Math.round(((s.best + s.good) / s.played) * 100) : 0,
  }));
  const rated = stats.filter((s) => s.played >= 2).sort((a, b) => a.accuracy - b.accuracy);
  return {
    ...publicUser(u),
    accuracy: u.roundsPlayed ? Math.round((u.correctCount / u.roundsPlayed) * 100) : 0,
    avgResponseSec: u.respondedRounds ? +(u.totalResponseMs / u.respondedRounds / 1000).toFixed(1) : null,
    timeouts: u.timeouts,
    categories: stats,
    weakestCategory: rated[0] ? rated[0].category : null,
    nextRankAt: nextRankAt(u.totalScore),
    history: u.history.slice(-20).reverse(),
  };
}

function nextRankAt(total) {
  const steps = [300, 1000, 2500, 5000];
  return steps.find((s) => total < s) || null;
}

/* ---------- scenario selection ---------- */

function listScenarios(mode) {
  return SCENARIOS.filter((s) => !mode || s.modes.includes(mode)).map((s) => ({
    id: s.id, title: s.title, category: s.category, difficulty: s.difficulty, severity: s.severity, modes: s.modes,
  }));
}

function weaknessWeight(user, scenario) {
  const s = user.categoryStats[scenario.category];
  if (!s || s.played < 1) return 2;                       // unseen categories are interesting
  const acc = (s.best + s.good) / s.played;
  return 1 + (1 - acc) * 2;                                // weak categories appear more
}

function pickScenario(user, mode, difficulty) {
  let pool = SCENARIOS.filter((s) => s.modes.includes(mode));
  if (difficulty) {
    const filtered = pool.filter((s) => s.difficulty === difficulty);
    if (filtered.length) pool = filtered;
  }
  const recent = new Set(user.history.slice(-RECENT_WINDOW).map((h) => h.scenarioId));
  const fresh = pool.filter((s) => !recent.has(s.id));
  if (fresh.length) pool = fresh;
  return weightedPick(pool, (s) => weaknessWeight(user, s));
}

/* ---------- round views ---------- */

function remainingMs(round, now) {
  return Math.max(0, round.startedAt + round.durationMs - now);
}

function roundView(round, now) {
  const sc = BY_ID[round.scenarioId];
  const byId = Object.fromEntries(sc.options.map((o) => [o.id, o]));
  return {
    roundId: round.id,
    status: round.status,
    mode: round.mode,
    serverNow: now,
    startedAt: round.startedAt,
    expiresAt: round.startedAt + round.durationMs,
    durationMs: round.durationMs,
    remainingMs: remainingMs(round, now),
    hintsUsed: round.hintsUsed,
    hintsAvailable: MAX_HINTS - round.hintsUsed,
    hints: round.revealedHints,
    eliminated: round.eliminated,
    scenario: {
      id: sc.id, title: sc.title, category: sc.category, difficulty: sc.difficulty,
      severity: sc.severity, briefing: sc.briefing, evidence: sc.evidence,
    },
    options: round.optionOrder.map((oid, i) => ({ key: i + 1, id: oid, text: byId[oid].text })),
  };
}

/* ---------- game actions ---------- */

function startRound(store, user, { mode, scenarioId, difficulty }, now) {
  mode = mode || 'beginner';
  if (!MODES[mode]) throw new HttpError(400, `Unknown mode "${mode}"`, 'BAD_MODE');
  if (difficulty !== undefined && ![1, 2, 3].includes(Number(difficulty))) {
    throw new HttpError(400, 'difficulty must be 1, 2 or 3', 'BAD_DIFFICULTY');
  }

  let sc;
  if (scenarioId) {
    sc = BY_ID[scenarioId];
    if (!sc) throw new HttpError(404, 'Scenario not found', 'NO_SCENARIO');
    if (!sc.modes.includes(mode)) throw new HttpError(400, 'Scenario is not part of this mode', 'BAD_MODE');
  } else {
    sc = pickScenario(user, mode, difficulty ? Number(difficulty) : undefined);
  }

  if (user.activeRoundId) {
    const old = store.getRound(user.activeRoundId);
    if (old && old.status === 'active') { old.status = 'abandoned'; store.putRound(old); }
  }

  const round = {
    id: id('rnd'), userId: user.id, mode, scenarioId: sc.id, difficulty: sc.difficulty,
    startedAt: now, durationMs: ROUND_MS,
    optionOrder: shuffle(sc.options.map((o) => o.id)),
    hintsUsed: 0, revealedHints: [], eliminated: [],
    status: 'active', result: null,
  };
  store.putRound(round);
  user.activeRoundId = round.id;
  store.putUser(user);
  return roundView(round, now);
}

function ownedRound(store, user, roundId) {
  const round = store.getRound(roundId);
  if (!round) throw new HttpError(404, 'Round not found', 'NO_ROUND');
  if (round.userId !== user.id) throw new HttpError(403, 'Not your round', 'FORBIDDEN');
  return round;
}

function getRound(store, user, roundId, now) {
  const round = ownedRound(store, user, roundId);
  if (round.status === 'active' && now > round.startedAt + round.durationMs + GRACE_MS) {
    return { ...roundView(round, now), needsResolution: true };
  }
  return roundView(round, now);
}

function useHint(store, user, roundId, now) {
  const round = ownedRound(store, user, roundId);
  if (round.status !== 'active') throw new HttpError(409, 'Round is already finished', 'ROUND_FINISHED');
  if (now > round.startedAt + round.durationMs + GRACE_MS) throw new HttpError(409, 'Round has expired', 'ROUND_EXPIRED');
  if (round.hintsUsed >= MAX_HINTS) throw new HttpError(409, 'No hints left', 'NO_HINTS');

  const sc = BY_ID[round.scenarioId];
  const penalty = HINT_PENALTY[round.hintsUsed];
  let hint;
  if (round.hintsUsed === 0) {
    hint = { type: 'text', text: sc.hint };
  } else {
    const wrong = sc.options.filter((o) => !round.eliminated.includes(o.id));
    const target = wrong.find((o) => o.quality === 'dangerous') || wrong.find((o) => o.quality === 'poor');
    round.eliminated.push(target.id);
    hint = { type: 'eliminate', optionId: target.id };
  }
  round.hintsUsed += 1;
  round.revealedHints.push(hint);
  store.putRound(round);
  return { hint, penalty, hintsUsed: round.hintsUsed, hintsAvailable: MAX_HINTS - round.hintsUsed, remainingMs: remainingMs(round, now), eliminated: round.eliminated };
}

function awardBadges(user, ctx) {
  const earned = [];
  const give = (code, label) => { if (!user.badges.some((b) => b.code === code)) { const b = { code, label, at: Date.now() }; user.badges.push(b); earned.push(b); } };
  if (user.roundsPlayed === 1) give('first_round', 'First Response');
  if (ctx.quality === 'best' && ctx.elapsedMs < 10_000 && ctx.hintsUsed === 0) give('quick_draw', 'Quick Draw (best answer under 10s)');
  if (user.streak >= 3) give('hot_streak', 'Hot Streak (3 in a row)');
  if (user.streak >= 5) give('unstoppable', 'Unstoppable (5 in a row)');
  if (ctx.quality === 'best' && ctx.difficulty === 3 && ctx.hintsUsed === 0) give('elite_analyst', 'Elite Analyst (hard scenario, no hints)');
  const cat = user.categoryStats[ctx.category];
  if (cat && cat.best >= 3) give('category_master', `Category Master: ${ctx.category}`);
  return earned;
}

async function submitDecision(store, user, roundId, optionId, now, aiOpts) {
  const round = ownedRound(store, user, roundId);
  if (round.status !== 'active') throw new HttpError(409, 'Round is already finished', 'ROUND_FINISHED');

  const sc = BY_ID[round.scenarioId];
  const elapsedMs = now - round.startedAt;
  const expired = elapsedMs > round.durationMs + GRACE_MS;

  let chosen = null;
  if (optionId !== undefined && optionId !== null) {
    if (!round.optionOrder.includes(optionId)) throw new HttpError(400, 'Unknown option for this round', 'BAD_OPTION');
    chosen = sc.options.find((o) => o.id === optionId);
  } else if (elapsedMs < round.durationMs - GRACE_MS) {
    throw new HttpError(400, 'optionId is required until the timer has run out', 'MISSING_OPTION');
  }

  const timedOut = expired || !chosen;
  const quality = timedOut ? 'timeout' : chosen.quality;
  const clampedElapsed = Math.min(elapsedMs, round.durationMs);
  const remaining = Math.max(0, round.durationMs - clampedElapsed);

  const score = computeScore({
    quality, remainingMs: remaining, hintsUsed: round.hintsUsed,
    difficulty: round.difficulty, streakBefore: user.streak,
  });

  // ---- mutate state synchronously BEFORE any await (blocks double-submits) ----
  round.status = timedOut ? 'timed_out' : 'completed';
  const prevBest = user.bestScore;
  user.roundsPlayed += 1;
  user.totalScore += score.total;
  user.bestScore = Math.max(user.bestScore, score.total);
  user.activeRoundId = null;
  const good = quality === 'best' || quality === 'good';
  if (good) { user.correctCount += 1; user.streak += 1; user.bestStreak = Math.max(user.bestStreak, user.streak); }
  else user.streak = 0;
  if (timedOut) user.timeouts += 1;
  else { user.totalResponseMs += clampedElapsed; user.respondedRounds += 1; }
  const cs = (user.categoryStats[sc.category] ||= { played: 0, best: 0, good: 0, poor: 0, dangerous: 0, timeout: 0 });
  cs.played += 1; cs[quality] += 1;
  user.history.push({
    roundId: round.id, scenarioId: sc.id, title: sc.title, category: sc.category, mode: round.mode,
    quality, score: score.total, elapsedMs: Math.round(clampedElapsed), at: now,
  });
  if (user.history.length > 100) user.history.shift();
  const newBadges = awardBadges(user, { quality, elapsedMs: clampedElapsed, hintsUsed: round.hintsUsed, difficulty: round.difficulty, category: sc.category });
  const isNewHiScore = score.total > prevBest;
  store.putRound(round);
  store.putUser(user);

  // ---- AI feedback (validated, with static fallback) ----
  const best = sc.options.find((o) => o.quality === 'best');
  const feedback = await generateFeedback({ scenario: sc, chosen, best, quality, timedOut }, aiOpts);

  const result = {
    roundId: round.id,
    status: round.status,
    timedOut,
    elapsedMs: Math.round(clampedElapsed),
    remainingMs: Math.round(remaining),
    chosen: chosen ? { id: chosen.id, text: chosen.text, quality: chosen.quality } : null,
    best: { id: best.id, text: best.text, why: best.why },
    verdict: feedback.verdict,
    feedback: { source: feedback.source, explanation: feedback.explanation, lesson: feedback.lesson, tip: feedback.tip },
    score,
    isNewHiScore,
    previousBest: prevBest,
    newBadges,
    review: sc.options.map((o) => ({ id: o.id, text: o.text, quality: o.quality, why: o.why })),
    learned: [sc.lesson],
    user: publicUser(user),
  };
  round.result = result;
  store.putRound(round);
  return result;
}

function leaderboard(store, by = 'total', limit = 20) {
  const key = by === 'best' ? 'bestScore' : 'totalScore';
  return store.allUsers()
    .filter((u) => u.roundsPlayed > 0)
    .sort((a, b) => b[key] - a[key] || a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((u, i) => ({ position: i + 1, username: u.username, rank: rankFor(u.totalScore), totalScore: u.totalScore, bestScore: u.bestScore, roundsPlayed: u.roundsPlayed, bestStreak: u.bestStreak }));
}

module.exports = {
  newUser, publicUser, progressView, listScenarios, startRound, getRound, useHint,
  submitDecision, leaderboard, MODES,
};
