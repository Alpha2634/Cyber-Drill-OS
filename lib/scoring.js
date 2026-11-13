'use strict';

const ROUND_MS = 60_000;          // 60-second decision window
const GRACE_MS = 1_500;           // network latency allowance
const MAX_HINTS = 2;
const HINT_PENALTY = [15, 25];    // 1st hint, 2nd hint

const BASE = { best: 100, good: 60, poor: 20, dangerous: 0 };
const MAX_TIME_BONUS = 50;
const DIFFICULTY_MULT = { 1: 1, 2: 1.25, 3: 1.5 };

const VERDICT = { best: 'correct', good: 'partial', poor: 'incorrect', dangerous: 'incorrect', timeout: 'incorrect' };

const RANKS = [
  [0, 'Rookie'], [300, 'Analyst'], [1000, 'Responder'], [2500, 'Threat Hunter'], [5000, 'CISO'],
];
const rankFor = (total) => RANKS.filter(([min]) => total >= min).pop()[1];

/**
 * Pure scoring function. All inputs are server-trusted.
 * @param {{quality:'best'|'good'|'poor'|'dangerous'|'timeout', remainingMs:number,
 *          hintsUsed:number, difficulty:number, streakBefore:number}} p
 */
function computeScore({ quality, remainingMs, hintsUsed, difficulty, streakBefore }) {
  if (quality === 'timeout') {
    return { base: 0, timeBonus: 0, hintPenalty: 0, subtotal: 0, difficultyMultiplier: 1, streakMultiplier: 1, total: 0 };
  }
  const base = BASE[quality];
  const ratio = Math.max(0, Math.min(1, remainingMs / ROUND_MS));
  const timeBonus = quality === 'best' || quality === 'good' ? Math.floor(MAX_TIME_BONUS * ratio) : 0;
  const hintPenalty = HINT_PENALTY.slice(0, hintsUsed).reduce((s, n) => s + n, 0);
  const subtotal = Math.max(0, base + timeBonus - hintPenalty);
  const difficultyMultiplier = DIFFICULTY_MULT[difficulty] || 1;
  const streakMultiplier = 1 + Math.min(0.5, 0.1 * streakBefore);
  const total = Math.round(subtotal * difficultyMultiplier * streakMultiplier);
  return { base, timeBonus, hintPenalty, subtotal, difficultyMultiplier, streakMultiplier: +streakMultiplier.toFixed(2), total };
}

module.exports = { ROUND_MS, GRACE_MS, MAX_HINTS, HINT_PENALTY, VERDICT, computeScore, rankFor };
