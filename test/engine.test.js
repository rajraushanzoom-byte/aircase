const test = require('node:test');
const assert = require('node:assert');
const A = require('../engine.js');

test('CPCB PM2.5 bands', () => {
  assert.equal(A.band(20), 'Good');
  assert.equal(A.band(95), 'Poor');
  assert.equal(A.band(300), 'Severe');
  assert.equal(A.band(NaN), 'Unknown');
  assert.equal(A.band(-5), 'Unknown');
});

test('coarse particles + construction observation => dust', () => {
  const r = A.rank({ pm25: 70, pm10: 210, hour: 14 }, { activity: 'construction' });
  assert.equal(r.top.id, 'dust');
  assert.equal(r.verdict, 'likely');
});

test('night fine-particle spike + smoke smell => burning', () => {
  const r = A.rank({ pm25: 140, pm10: 170, hour: 22, no2: 15 }, { smell: 'smoke' });
  assert.equal(r.top.id, 'burning');
});

test('high SO2 + chemical smell => industry', () => {
  const r = A.rank({ pm25: 90, pm10: 130, so2: 40, hour: 11 }, { smell: 'chemical' });
  assert.equal(r.top.id, 'industry');
});

test('high NO2 in rush hour => traffic', () => {
  const r = A.rank({ pm25: 80, pm10: 120, no2: 70, hour: 9 }, {});
  assert.equal(r.top.id, 'traffic');
});

test('no evidence => inconclusive, never overclaims', () => {
  const r = A.rank({ pm25: 40, pm10: 70, hour: 13 }, {});
  assert.equal(r.verdict, 'inconclusive');
});

test('missing readings do not crash or bias', () => {
  const r = A.rank({}, {});
  assert.equal(r.verdict, 'inconclusive');
  const sum = r.ranked.reduce((a, x) => a + x.confidence, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('adaptive questions: coarse mix asks about activity first, then smell, then stops', () => {
  const rd = { pm25: 50, pm10: 150 };
  assert.equal(A.nextQuestion(rd, {}).id, 'activity');
  assert.equal(A.nextQuestion(rd, { activity: 'none' }).id, 'smell');
  assert.equal(A.nextQuestion(rd, { activity: 'none', smell: 'none' }), null);
  assert.equal(A.nextQuestion({ pm25: 90, pm10: 100, so2: 50 }, {}).id, 'smell');
});

test('sanitize strips markup and control chars and caps length', () => {
  assert.equal(A.sanitize('<script>x</script>\n\nhi', 100), 'script x /script hi');
  assert.equal(A.sanitize('a'.repeat(500), 50).length, 50);
  assert.equal(A.sanitize(null), '');
});

test('complaint includes readings, honest wording and right authority', () => {
  const readings = { pm25: 142, pm10: 200, no2: 20, so2: 5, co: 300, windSpeed: 6, windDir: 90 };
  const result = A.rank({ ...readings, hour: 14 }, { activity: 'construction' });
  const text = A.buildComplaint({ area: 'Indiranagar', when: '2026-11-20 14:00', readings, result, obs: { activity: 'construction' }, notes: '' });
  assert.match(text, /PM2\.5: 142/);
  assert.match(text, /Very poor/);
  assert.match(text, /not a direct measurement/);
  assert.match(text, /east/);
  assert.match(text, /State Pollution Control Board/);
});

test('protection advice scales with severity', () => {
  assert.match(A.protection(20), /No special/);
  assert.match(A.protection(300), /N95/);
});
