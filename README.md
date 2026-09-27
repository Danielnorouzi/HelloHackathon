# HelloHackathon

## Description

Soccer Scout is our group project for HelloHack 2026. It allows user to search for a professional player, see a data driven analysis of how they pla and their style, generate a training plan to develop similar abilities and even a live coach to check your form and gives live feedback. 

### Player Data attribution

- **StatsBomb Open Data**: event data for La Liga 2004/05–2020/21 (Barcelona matches) and the
  FIFA World Cup 2022. Free for non-commercial use. https://github.com/statsbomb/open-data
- **API-Football**: basic stats for players outside the StatsBomb data (free tier, cached).

## AI and ML models

- **OpenAI:** Used for analyzing players data and playstyle, creating workout plans, and live coach.
- **Google MediaPipe:** Used for body postioning and ball detection in the browser (live Coach). 

## Fast launch using localhost (set up before hand)
- **Launch**: start both servers as above, open http://localhost:5173/coach, choose a skill, and press

### Setup

Requirements: Python 3.11+, Node 20+.

> **Windows note:** keep the project in a short path (e.g. `C:\dev\soccer-scout` or
> `Downloads\soccer-scout`). Very long paths break the compiled DLLs in SQLAlchemy/scikit-learn.

#### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # macOS/Linux: .venv/bin/python
cp .env.example .env                                          # then add your keys
```

#### Preload the data (one time, ~20–40 min, 930 matches, ~0.9 GB)

```bash
cd backend
.venv/Scripts/python -m scripts.preload_statsbomb   # download StatsBomb data into data/soccer.db (resumable)
.venv/Scripts/python -m scripts.verify_preload      # check Messi's goals/assists per season
.venv/Scripts/python -m scripts.build_metrics       # build per-90 stats and percentiles
```

#### Run

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000   # restart after backend edits (--reload is unreliable on Windows)
cd frontend && npm install && npm run dev            # http://localhost:5173


**Tests**
```bash
cd backend && .venv/Scripts/python -m pytest        # rules, summary, isolation from analysis data
cd frontend && npm test                             # phase detection, rules parity, cue scheduling
```




### Project structure

```
backend/
  app/            FastAPI app: db, metrics, players, rating, llm, api_football
  app/coach/      Live Skills Coach API, voice, summary, separate coach database
  config/         demo players, rating weights, skill-test benchmarks, coach_rules.json
  tests/          pytest suite (Live Skills Coach)
  scripts/        preload, verification and cache-warming scripts
  data/           SQLite database (generated)
frontend/
  src/components  pitch visuals and charts
  src/pages       Home, Players, Player, My Profile, Train, Live Coach
  src/coach       live vision, skill phases, rules, cue scheduler, voice
```


### How the pieces work

- **Tiers.** StatsBomb players are Tier 2 (full event data: pitch maps, report, card). Other players come
  from API-Football as Tier 1 (season totals only: card and a short report, lower confidence).
- **Possession-adjusted defending (PAdj).** Defensive actions are scaled by 50% / opponent possession
  (estimated from pass share, capped x0.5–x2) so players on dominant teams aren't penalised.
- **AI (`backend/app/llm.py`).** Provider and model come from `.env` (`LLM_PROVIDER=openai|anthropic`).
  The AI only sees a JSON summary, must cite evidence keys that exist in it, and every reply is validated
  and cached in `llm_cache`. `OFFLINE_MODE=true` serves cache only.
- **API-Football (`backend/app/api_football.py`).** Every response cached in `api_cache`; the app stops
  at 90 requests/day. Typing in search never calls the API; "Search more leagues" does, once per query.
- **Skill tests (`backend/config/benchmarks.json`).** Rough coaching benchmarks by age group; results
  map to 40–99. Your card's PAC comes from the sprint tests.
- **Training plan (`backend/app/plan.py`).** Code picks the 2–3 biggest gaps, the training/rest days and
  the day-7 re-test; the AI writes the sessions, which are checked against your equipment and time.

### Data quality: the six criteria

`scripts/fill_criteria.py` (run automatically by `build_metrics`, safe to re-run) records every card
criterion (PAC, SHO, PAS, DRI, DEF, PHY) for every player-season as columns on `player_season_stats`
(`crit_<C>`, `crit_<C>_source`, `crit_<C>_basis`); it never adds rows. Values are **measured** from
source data; if missing, **imputed** as the median of measured values in the same position group (at
least 30 values) or overall; or **unavailable** when no source measures it and no player has a measured
value. Valid zeros are kept. A summary is written to `backend/data/criteria_report.json`.
Currently SHO, PAS, DRI and DEF are measured for all 6,567 player-seasons; PAC and PHY are unavailable
for all of them (they need tracking data), so they are not imputed. Imputed values show "est" on cards.

### Profile and comparisons

- Change your display name on My Profile (updates the profile in place).
- A short physical and defending self-assessment gives a rough PHY and DEF, always labelled "self",
  never part of OVR, and used only to guide comparisons and training plans.
- Compare with any player in the dataset (search or demo shortcuts). All six ratings are
  higher-is-better; the higher value is green with ▲, the lower orange with ▼, ties and missing values
  stay neutral.

### Live Skills Coach (Live Coach tab)

Practise **shooting** or **dribbling** in front of a camera and get short spoken hints.

**How it works**
1. **Vision, entirely in the browser** (`frontend/src/coach/vision.js`, `tracking.js`): MediaPipe pose
   (33 body points) plus a ball detector that searches a crop around the feet. At start-up it times GPU vs
   CPU on your device and keeps the faster one (falling back to the lite pose model on slow machines).
   Landmarks are smoothed (One-Euro filter) and the ball is tracked between detections.
2. **Skill phases and measurements** (`frontend/src/coach/skills/`): shooting = approach → plant →
   contact → follow-through; dribbling = runs, touches, close control, lost control. Distances are in
   *leg lengths* and angles in degrees. Every measurement has a confidence and is **withheld with a
   reason** when tracking isn't good enough (ball not seen at contact, camera not side-on, body hidden…).
3. **Rules → cues** (`backend/config/coach_rules.json`, `rules.js`, `feedback.js`): explicit thresholds
   pick at most one cue per attempt. Minor issues must repeat before being mentioned; every cue has a
   cooldown; nothing is said within 6 s of the last cue or while anyone is talking; low-confidence
   attempts get a camera-setup hint instead of a correction.
4. **Voice** (`backend/app/coach/`): cues are spoken by the server's AI voice (streamed, cached, key
   stays on the server) or the browser's built-in voice as a fallback. "Hold to ask" records a question
   (microphone requested only then) → transcribed → answered by the LLM using **only the measured
   numbers** (a filter strips any invented speeds/distances) → spoken. Typed questions work too.
5. **Ball lost**: a soft, debounced chime (at most every 8 s, 3 times until the ball is seen again)
   instead of speech; the Sound toggle mutes it.
6. **Touch quality and boot zones**: kicking-foot angle at contact (laces strike), heavy touches and
   toe pokes, only when the feet and ball are tracked well enough. Cues about where to strike the ball
   light up that part of the boot graphic beside the camera.
7. **Summary**: ending a session sends the measurements (never video) to the server, which builds
   strengths, repeated corrections with evidence, and tracking limitations deterministically, plus an
   optional short AI wrap-up, and one or two drills chosen for the issues actually measured
   (`backend/config/coach_drills.json`). Stored in a separate database, `backend/data/coach.db`.

**Privacy**: video is never recorded or uploaded; a "video file" is analysed in the browser tab only.
Question audio is sent once for transcription and not stored.

**Never measured**: shot power, ball speed, accuracy, distances in metres. They need a calibrated camera
and a visible target.


