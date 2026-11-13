# CyberDrill: 60-Second Incident Trainer (full project)

Frontend (retro CRT arcade terminal) + backend (scoring, timer, progress, validated AI feedback) in one folder.

## Run in VS Code
1. File > Open Folder... and choose this `CyberDrill` folder.
2. Open the terminal (Ctrl+`) and run `npm start` (or press Ctrl+Shift+B).
3. Open http://localhost:3000. The game is served by the same server.

Requires Node.js 20+. There is nothing to install (no dependencies). Run `npm test` for the 16 backend tests.

## Folder layout
```
CyberDrill/
  server.js, app.js      HTTP server and API routes
  lib/                   scoring.js, game.js (rounds, hints, timer), ai.js (validation), store.js
  data/scenarios.js      13 incidents (edit here to add more)
  test/                  automated tests
  public/                the frontend: index.html, css/style.css, js/app.js
  .vscode/               start/test tasks
```

## How the frontend uses the backend
- On load it creates a player automatically and keeps the token in `localStorage` (`cd_token`).
- Incidents, the 60 s timer, hints, scoring and feedback all come from the API. The server is the source of truth for time and score.
- Offline fallback: if the server is not reachable (for example you double-click `public/index.html`), the boot screen says `OFFLINE (LOCAL MODE)` and the original built-in incidents are used.
- Using VS Code Live Server (port 5500) also works: the frontend then calls http://localhost:3000, so the backend must be running.
- To reset your progress: delete `data/db.json` and clear the site's localStorage.

Original frontend notes are in `public/FRONTEND_README.md`. The backend documentation follows.

---


60-second cyber incident decision trainer. This is the backend developer's part:
APIs, scenario data, scoring, timer/round logic, progress storage, frontend connection, and
validation of AI responses.

Zero dependencies. Requires Node 20+.

```bash
npm start            # http://localhost:3000   (PORT=... to change)
npm test             # 16 automated tests
```

Optional AI feedback: `ANTHROPIC_API_KEY=... npm start` (model via `AI_MODEL`, default `claude-haiku-5-5`).
Without a key the game uses the built-in explanations, so it always works offline.

Put the frontend build in `public/` (e.g. `public/index.html`) and the same server serves it. No CORS issues.

## How a round works

```
POST /api/users            -> token
POST /api/rounds           -> scenario + 4 options + timer (server clock)
POST /api/rounds/:id/hint  -> optional, costs points
POST /api/rounds/:id/decision {optionId}
                           -> score, verdict, AI/static feedback, best answer, review, badges, new hi-score
GET  /api/me               -> progress, accuracy, weakest category, history
GET  /api/leaderboard
```

All endpoints except `/api/users`, `/api/health`, `/api/config`, `/api/scenarios`, `/api/leaderboard`
need `Authorization: Bearer <token>`.

## API reference

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, ai}` |
| GET | `/api/config` | round length, hint penalties, modes |
| GET | `/api/scenarios?mode=soc` | titles only, no answers |
| POST | `/api/users` `{username}` | 2-20 chars. Returns `{token, user}`. Save the token. |
| GET | `/api/me` | totals, rank, accuracy, avg response time, category stats, weakest category, last 20 rounds |
| POST | `/api/rounds` `{mode, scenarioId?, difficulty?}` | `mode`: `beginner` \| `employee` \| `soc`. Omit `scenarioId` for adaptive pick. |
| GET | `/api/rounds/:id` | resume after refresh (`remainingMs`, revealed hints) |
| POST | `/api/rounds/:id/hint` | hint 1 = text (-15), hint 2 = removes a wrong option (-25). Max 2. |
| POST | `/api/rounds/:id/decision` `{optionId}` | omit `optionId` only after the timer hit 0 (counts as timeout) |
| GET | `/api/leaderboard?by=total\|best&limit=20` | |

Errors: `{ "error": { "code": "ROUND_FINISHED", "message": "..." } }` with proper HTTP status
(400, 401, 403, 404, 409, 413, 429).

### Round start response (what the frontend renders)

```json
{
  "roundId": "rnd_ab12...", "serverNow": 1760000000000, "expiresAt": 1760000060000,
  "durationMs": 60000, "remainingMs": 60000, "hintsAvailable": 2,
  "scenario": { "title": "...", "category": "Phishing", "difficulty": 1, "severity": "medium",
                "briefing": "...", "evidence": ["...", "..."] },
  "options": [ { "key": 1, "id": "c", "text": "..." }, ... ]
}
```

`key` is the keyboard number (1-4). Option order is shuffled per round. Answer quality is never sent
until the round ends.

### Decision response (results screen)

`verdict` (`correct|partial|incorrect`), `score {base, timeBonus, hintPenalty, difficultyMultiplier,
streakMultiplier, total}`, `feedback {source: "ai"|"static", explanation, lesson, tip}`, `best`,
`review[]` (every option with its quality and why), `learned[]`, `newBadges[]`, `isNewHiScore`,
`previousBest`, and `user {rank, totalScore, streak, ...}`.

## Scoring

```
base        best 100 | good 60 | poor 20 | dangerous 0
time bonus  up to +50, linear in remaining time (best/good only)
hints       -15, then -25
total = (base + timeBonus - hints, min 0) x difficulty (1 / 1.25 / 1.5) x streak (1 + 0.1 per streak, max 1.5)
timeout     0 points, streak resets
```

Ranks by total score: Rookie, Analyst (300), Responder (1000), Threat Hunter (2500), CISO (5000).
Badges: First Response, Quick Draw, Hot Streak, Unstoppable, Elite Analyst, Category Master.

## Timer (server authoritative)

The browser timer is cosmetic. The server records `startedAt` and computes elapsed time itself, with
1.5 s grace for latency. Late answers become timeouts, so players cannot freeze the timer or
replay a round. Use `serverNow` at round start to correct clock drift:

```js
const offset = round.serverNow - Date.now();
const remaining = () => Math.max(0, round.expiresAt - (Date.now() + offset));
```

## Validating AI responses (`lib/ai.js`)

1. The AI never decides score or correctness; it only explains the server's verdict.
2. Players send only an `optionId`, so no free text reaches the model.
3. Output must be JSON with `verdict`, `explanation`, `lesson`, optional `tip`.
4. Rejected (falls back to static text) if: not JSON, wrong types, verdict differs from the server's,
   prompt-injection phrases, claims about points, tone that contradicts the verdict, bad lengths.
5. Accepted text is sanitised: HTML, markdown and URLs are stripped.
6. 5 s timeout and any error also fall back. The response says `feedback.source` so the UI can show an "AI" tag.

## Advanced features included

- Adaptive scenario selection: avoids the last 5 played, favours your weakest categories.
- Two-stage hints (text, then eliminates a wrong answer) with score penalties.
- Streaks, difficulty multipliers, ranks, badges, hi-score detection.
- Post-round review of every option with explanations (the "what you learned" screen).
- Resume an in-progress round after a page refresh.
- Rate limiting, body-size limit, per-user round ownership, atomic JSON persistence.

## Frontend wiring (fetch)

```js
const API = ''; // same origin when served from public/
let token = localStorage.getItem('token');

async function api(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(API + path, {
    method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error.message);
  return j;
}

// login once
const { token: t } = await api('/api/users', { username: 'fatima' });
localStorage.setItem('token', (token = t));

// play
const round = await api('/api/rounds', { mode: 'soc' });
const hint  = await api(`/api/rounds/${round.roundId}/hint`, {});
const res   = await api(`/api/rounds/${round.roundId}/decision`, { optionId: round.options[0].id });
// on timer 0:  api(`/api/rounds/${id}/decision`, {})
```

## Adding scenarios

Add an object to `data/scenarios.js`: exactly 4 options, exactly one `best`, at least one `dangerous`
(used by hint 2). `npm test` validates this.

## Production notes

The JSON-file store is for hackathon scale. `lib/store.js` is the only place to swap for SQLite/MongoDB.
