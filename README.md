# AirCase: Urban Air Quality Assistant

**Vertical / persona:** a resident or resident welfare association that keeps breathing dust, smoke or fumes but has no evidence to make authorities act.

## Problem
People know the air is bad but not *why*, and complaints like "air is bad here" are ignored. AirCase turns a feeling into a case file: readings, wind, a ranked likely source, and a ready-to-send complaint.

## Approach and logic
1. **Data:** Open-Meteo geocoding, air-quality and weather APIs (free, no key) give PM2.5, PM10, NO2, SO2, CO and wind for the place.
2. **Decision engine (`engine.js`, deterministic and tested):** scores four source hypotheses (dust, open burning, vehicles, industry) from pollutant ratios (e.g. PM2.5/PM10), time of day and what the user observes. It returns calibrated-looking confidence and says "inconclusive" when evidence is thin instead of guessing.
3. **Adaptive questions:** it asks the most useful unanswered question first (smell vs. what is visible), based on the readings.
4. **Complaint builder:** picks the right kind of authority for the likely source, includes numbers, wind and honest uncertainty wording.
5. **Gen AI (Gemini, optional):** `api/analyze.js` translates and polishes the complaint into Hindi or Kannada. The AI never decides the source. It only rewrites text, with numbers preserved. If the key is missing or the call fails, the English draft still works.

## Assumptions and limits
- Source attribution is a **heuristic**, not proof. The UI and complaint say "likely" and show confidence.
- Open-Meteo data is modelled on a coarse grid, not street-level monitors.
- Thresholds (ratios, NO2/SO2/CO cut-offs) are reasoned rules of thumb, kept in one place in `engine.js` for easy tuning.
- AQI bands follow CPCB PM2.5 breakpoints. Not medical advice.

## Quality
- **Testing:** `npm test` (Node built-in runner, 11 tests: bands, each source, no-evidence, missing data, questions, sanitising, complaint content).
- **Security:** no keys in the repo (`GEMINI_API_KEY` env var), input sanitising and length limits on client and server, per-IP rate limit, output rendered with `textContent`, system prompt treats letter text as data.
- **Efficiency:** two parallel API calls per check, no dependencies, tiny bundle.
- **Accessibility:** semantic form and labels, live status region, keyboard-only use, visible focus, 44px targets, confidence shown as text as well as bars.

## Run and deploy
```
npm test
npx serve .            # static UI (AI polish needs the serverless function)
```
Deploy on Vercel: import the repo, set `GEMINI_API_KEY` (optional `GEMINI_MODEL`), done. `api/analyze.js` is picked up automatically.
