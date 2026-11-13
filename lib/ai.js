'use strict';
const { VERDICT } = require('./scoring');

/**
 * AI feedback layer.
 *
 * Design rules (this is the "validate AI responses before using them" part):
 *  1. The AI NEVER decides the score or which option is correct. The server
 *     already knows that from the scenario bank. The AI only explains.
 *  2. Players only submit an option id, so no player free-text reaches the model.
 *  3. Whatever the model returns is parsed, schema-checked, sanitised and
 *     cross-checked against the server's verdict. Anything off -> static fallback.
 */

const INJECTION_RE = /(ignore (all|any|previous|prior)|system prompt|as an ai (language )?model|developer message|<\s*script|javascript:)/i;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const TAG_RE = /<[^>]*>/g;
const POINTS_RE = /\b\d+\s*(points?|pts)\b/i;
const CONTRADICTION = {
  correct: /\b(incorrect|wrong|dangerous mistake|bad choice)\b/i,
  incorrect: /\b(perfect choice|excellent choice|well done|great job|you chose correctly)\b/i,
  partial: /\b(perfect choice|completely wrong)\b/i,
};

function clean(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(TAG_RE, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(URL_RE, '[link removed]')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/**
 * @returns {{ok:true, value:{verdict,explanation,lesson,tip}} | {ok:false, reasons:string[]}}
 */
function validateAIFeedback(raw, expectedVerdict) {
  const reasons = [];
  const obj = extractJson(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reasons: ['not a JSON object'] };

  for (const k of ['verdict', 'explanation', 'lesson']) {
    if (typeof obj[k] !== 'string') reasons.push(`missing or non-string "${k}"`);
  }
  if (obj.tip !== undefined && typeof obj.tip !== 'string') reasons.push('"tip" must be a string');
  if (reasons.length) return { ok: false, reasons };

  const verdict = obj.verdict.trim().toLowerCase();
  if (!['correct', 'partial', 'incorrect'].includes(verdict)) reasons.push('invalid verdict');
  if (verdict !== expectedVerdict) reasons.push(`verdict "${verdict}" disagrees with server verdict "${expectedVerdict}"`);

  const raws = [obj.explanation, obj.lesson, obj.tip || ''];
  if (raws.some((t) => INJECTION_RE.test(t))) reasons.push('suspicious content');
  if (raws.some((t) => POINTS_RE.test(t))) reasons.push('model tried to state a score');

  const explanation = clean(obj.explanation);
  const lesson = clean(obj.lesson);
  const tip = clean(obj.tip || '');

  if (explanation.length < 20 || explanation.length > 500) reasons.push('explanation length out of range');
  if (lesson.length < 10 || lesson.length > 200) reasons.push('lesson length out of range');
  if (tip.length > 160) reasons.push('tip too long');
  if (CONTRADICTION[expectedVerdict] && CONTRADICTION[expectedVerdict].test(explanation)) reasons.push('tone contradicts verdict');

  if (reasons.length) return { ok: false, reasons };
  return { ok: true, value: { verdict, explanation, lesson, tip } };
}

function buildPrompt(ctx) {
  const { scenario, chosen, best, verdict, timedOut } = ctx;
  return [
    'You are a cybersecurity trainer giving feedback after a timed incident decision game.',
    'Return ONLY a JSON object: {"verdict":"correct|partial|incorrect","explanation":"...","lesson":"...","tip":"..."}',
    `The verdict MUST be exactly "${verdict}". Do not mention scores or points. No markdown, no links.`,
    'explanation: 2-3 sentences, 20-450 chars. lesson: one sentence <=180 chars. tip: optional, <=150 chars.',
    '',
    `Scenario: ${scenario.title} (${scenario.category})`,
    `Situation: ${scenario.briefing}`,
    `Evidence: ${scenario.evidence.join(' | ')}`,
    timedOut ? 'The player ran out of time and chose nothing.' : `Player chose: ${chosen.text}`,
    `Best response: ${best.text}`,
  ].join('\n');
}

async function anthropicComplete(prompt, { apiKey, model, timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    return (data.content || []).map((c) => c.text || '').join('');
  } finally {
    clearTimeout(t);
  }
}

function staticFeedback({ scenario, chosen, best, verdict, timedOut }) {
  return {
    source: 'static',
    verdict,
    explanation: timedOut
      ? `Time ran out. In a real incident, hesitation lets attackers keep going. ${best.why}`
      : chosen.why,
    lesson: scenario.lesson,
    tip: scenario.tip || '',
  };
}

/**
 * @param ctx {scenario, chosen, best, quality, timedOut}
 * @param opts {complete?: (prompt)=>Promise<string>, apiKey?, model?, timeoutMs?, log?}
 */
async function generateFeedback(ctx, opts = {}) {
  const verdict = VERDICT[ctx.timedOut ? 'timeout' : ctx.quality];
  const full = { ...ctx, verdict };
  const fallback = staticFeedback(full);

  const complete = opts.complete
    || (opts.apiKey ? (p) => anthropicComplete(p, { apiKey: opts.apiKey, model: opts.model, timeoutMs: opts.timeoutMs || 5000 }) : null);
  if (!complete) return { ...fallback, aiRejected: null };

  try {
    const raw = await complete(buildPrompt(full));
    const check = validateAIFeedback(raw, verdict);
    if (!check.ok) {
      if (opts.log) opts.log('AI feedback rejected:', check.reasons.join('; '));
      return { ...fallback, aiRejected: check.reasons };
    }
    return { source: 'ai', ...check.value, aiRejected: null };
  } catch (err) {
    if (opts.log) opts.log('AI call failed:', err.message);
    return { ...fallback, aiRejected: ['ai unavailable'] };
  }
}

module.exports = { validateAIFeedback, generateFeedback, buildPrompt, staticFeedback };
