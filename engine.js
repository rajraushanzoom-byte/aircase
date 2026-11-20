/* AirCase decision engine: pure, deterministic, unit-tested. No network, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AirCase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // CPCB (India) PM2.5 AQI bands, ug/m3
  const BANDS = [[30, 'Good'], [60, 'Satisfactory'], [90, 'Moderate'], [120, 'Poor'], [250, 'Very poor'], [Infinity, 'Severe']];
  const SOURCES = {
    dust: 'Construction or road dust',
    burning: 'Open burning (garbage, leaves, wood)',
    traffic: 'Vehicle exhaust',
    industry: 'Industrial or chemical emissions'
  };
  const AUTHORITY = {
    dust: 'Your city municipal body (building / solid waste section) and the State Pollution Control Board',
    burning: 'Your city municipal body (solid waste management) and the State Pollution Control Board',
    traffic: 'Local traffic police and the regional transport office',
    industry: 'The State Pollution Control Board (regional office)'
  };
  const QUESTIONS = {
    smell: { id: 'smell', text: 'What does the air smell like?', options: [['smoke', 'Smoke or burning'], ['chemical', 'Chemical or sharp'], ['dust', 'Dusty or gritty'], ['none', 'No particular smell']] },
    activity: { id: 'activity', text: 'What can you see nearby?', options: [['construction', 'Construction or digging'], ['burning', 'Something burning'], ['traffic', 'Heavy traffic or jams'], ['industry', 'Factory or chimney'], ['none', 'Nothing obvious']] }
  };

  const gt = (v, t) => Number.isFinite(v) && v > t;
  const lt = (v, t) => Number.isFinite(v) && v < t;

  function band(pm25) {
    if (!Number.isFinite(pm25) || pm25 < 0) return 'Unknown';
    return BANDS.find((b) => pm25 <= b[0])[1];
  }

  function sanitize(text, max) {
    return String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300);
  }

  function compass(deg) {
    if (!Number.isFinite(deg)) return 'unknown direction';
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  // Score each possible source from pollutant fingerprint + what the resident observed.
  function rank(r, o) {
    r = r || {}; o = o || {};
    const ratio = r.pm10 > 0 && Number.isFinite(r.pm25) ? r.pm25 / r.pm10 : null;
    const night = r.hour >= 18 || r.hour < 6;
    const rush = (r.hour >= 7 && r.hour <= 10) || (r.hour >= 17 && r.hour <= 21);
    const s = {};
    Object.keys(SOURCES).forEach((k) => (s[k] = { id: k, label: SOURCES[k], score: 0, reasons: [] }));
    const add = (k, pts, why) => { s[k].score += pts; s[k].reasons.push(why); };

    if (ratio !== null) {
      const t = ratio.toFixed(2);
      if (ratio < 0.45) add('dust', 2, 'Coarse particles dominate (PM2.5/PM10 = ' + t + ')');
      else if (ratio < 0.6) add('dust', 1, 'Slightly coarse mix (PM2.5/PM10 = ' + t + ')');
      if (ratio > 0.65) add('burning', 1.5, 'Fine particles dominate (PM2.5/PM10 = ' + t + ')');
    }
    if (night && gt(r.pm25, 60)) add('burning', 1, 'Fine-particle spike at night, when open burning is common');
    if (gt(r.co, 1000)) add('burning', 1, 'Elevated carbon monoxide suggests combustion');
    if (gt(r.no2, 40)) add('traffic', 2, 'Elevated NO2 (' + Math.round(r.no2) + ' ug/m3) is typical of vehicles');
    if (gt(r.co, 800)) add('traffic', 1, 'Elevated carbon monoxide');
    if (rush) add('traffic', 1, 'Reading falls in rush hour');
    if (gt(r.so2, 20)) add('industry', 2.5, 'Elevated SO2 (' + Math.round(r.so2) + ' ug/m3) points to industrial fuel burning');

    if (o.smell === 'smoke') add('burning', 3, 'You report a smoke smell');
    if (o.smell === 'chemical') add('industry', 3, 'You report a chemical smell');
    if (o.smell === 'dust') add('dust', 1, 'You report dusty air');
    if (o.activity === 'construction') add('dust', 3, 'You can see construction or digging');
    if (o.activity === 'burning') add('burning', 3, 'You can see something burning');
    if (o.activity === 'traffic') add('traffic', 3, 'You can see heavy traffic');
    if (o.activity === 'industry') add('industry', 3, 'You can see a factory or chimney');

    const list = Object.keys(s).map((k) => s[k]);
    const total = list.reduce((a, x) => a + x.score + 0.5, 0);
    list.forEach((x) => (x.confidence = (x.score + 0.5) / total));
    list.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
    const top = list[0];
    const verdict = top.score < 2 ? 'inconclusive' : top.confidence >= 0.5 ? 'likely' : 'possible';
    return { ranked: list, verdict, top };
  }

  // Adaptive questioning: ask whichever unanswered question the readings make most useful.
  function nextQuestion(r, o) {
    o = o || {};
    const ratio = r && r.pm10 > 0 ? r.pm25 / r.pm10 : null;
    const order = gt(r && r.so2, 20) || !(ratio !== null && ratio < 0.5) ? ['smell', 'activity'] : ['activity', 'smell'];
    const id = order.find((k) => !o[k]);
    return id ? QUESTIONS[id] : null;
  }

  function protection(pm25) {
    const b = band(pm25);
    if (b === 'Good' || b === 'Satisfactory') return 'Air is acceptable right now. No special precautions.';
    if (b === 'Moderate') return 'Sensitive groups (children, elderly, asthma) should limit heavy outdoor activity.';
    if (b === 'Poor') return 'Keep windows closed near the source and wear a well-fitted mask outdoors.';
    if (b === 'Unknown') return 'No reading available. Avoid the affected spot if the air feels unsafe.';
    return 'Stay indoors where possible, wear a fitted N95/FFP2 mask outdoors, and run an air purifier if you have one.';
  }

  function buildComplaint(c) {
    const r = c.readings || {};
    const top = c.result.top;
    const area = sanitize(c.area, 80) || 'my area';
    const obs = [];
    if (c.obs && c.obs.smell && c.obs.smell !== 'none') obs.push('smell: ' + c.obs.smell);
    if (c.obs && c.obs.activity && c.obs.activity !== 'none') obs.push('visible: ' + c.obs.activity);
    const notes = sanitize(c.notes, 400);
    const n = (v) => (Number.isFinite(v) ? Math.round(v) : 'n/a');
    const lines = [
      'To: ' + (c.result.verdict === 'inconclusive' ? 'Your city municipal body and the State Pollution Control Board' : AUTHORITY[top.id]),
      'Subject: Air pollution complaint - ' + area,
      '',
      'Respected Sir/Madam,',
      '',
      'On ' + (sanitize(c.when, 40) || 'the date above') + ' I recorded poor air quality in ' + area + '.',
      'PM2.5: ' + n(r.pm25) + ' ug/m3 (' + band(r.pm25) + '), PM10: ' + n(r.pm10) + ' ug/m3, NO2: ' + n(r.no2) + ', SO2: ' + n(r.so2) + ', CO: ' + n(r.co) + '.',
      'Wind: ' + n(r.windSpeed) + ' km/h from the ' + compass(r.windDir) + '.',
      obs.length ? 'My observations: ' + obs.join('; ') + '.' : '',
      notes ? 'Additional notes: ' + notes : '',
      c.result.verdict === 'inconclusive'
        ? 'The source is not yet clear. I request an inspection of the locality.'
        : 'Most ' + c.result.verdict + ' source: ' + top.label.toLowerCase() + ' (' + Math.round(top.confidence * 100) + '% confidence, estimated from pollutant ratios and my observations, not a direct measurement).',
      '',
      'I request you to inspect the area, take action if a violation is found, and share a complaint reference number.',
      'Data source: Open-Meteo modelled air quality for the nearest grid point.',
      '',
      'Regards'
    ];
    return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
  }

  return { band, rank, nextQuestion, protection, buildComplaint, sanitize, compass, SOURCES, QUESTIONS };
});
