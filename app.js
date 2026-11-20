(function () {
  const $ = (id) => document.getElementById(id);
  const A = window.AirCase;
  const state = { readings: null, obs: {}, area: '', when: '' };

  const getJSON = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('Data service returned ' + r.status);
    return r.json();
  };
  const status = (msg, bad) => { const s = $('status'); s.textContent = msg; s.className = bad ? 'err' : ''; };
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

  async function geocode(name) {
    const g = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&name=' + encodeURIComponent(name));
    return g.results || [];
  }

  async function load(query) {
    // The place search matches one name only, so search the first part and use the rest as a hint.
    const parts = query.split(',').map((x) => x.trim()).filter(Boolean);
    const hint = parts.slice(1).join(' ').toLowerCase();
    let list = await geocode(parts[0]);
    let p = hint ? list.find((x) => JSON.stringify(x).toLowerCase().includes(hint.split(' ')[0])) : list[0];
    if (!p && hint) {
      // Locality not found: fall back to the city in the hint (nearest grid point).
      const city = await geocode(parts[parts.length - 1]);
      p = city[0];
    }
    if (!p) throw new Error('No place found. Try the city name, e.g. "Bengaluru".');
    const q = 'latitude=' + p.latitude + '&longitude=' + p.longitude + '&timezone=auto';
    const [a, w] = await Promise.all([
      getJSON('https://air-quality-api.open-meteo.com/v1/air-quality?' + q + '&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,sulphur_dioxide'),
      getJSON('https://api.open-meteo.com/v1/forecast?' + q + '&current=wind_speed_10m,wind_direction_10m')
    ]);
    const c = a.current || {};
    return {
      area: query,
      when: String(c.time || '').replace('T', ' '),
      readings: {
        pm25: c.pm2_5, pm10: c.pm10, no2: c.nitrogen_dioxide, co: c.carbon_monoxide, so2: c.sulphur_dioxide,
        hour: Number(String(c.time || '').slice(11, 13)),
        windSpeed: w.current && w.current.wind_speed_10m, windDir: w.current && w.current.wind_direction_10m
      }
    };
  }

  function showReadings() {
    const r = state.readings, box = $('readings');
    box.replaceChildren();
    box.append(el('h2', 'Air in ' + state.area));
    box.append(el('p', 'PM2.5 ' + Math.round(r.pm25) + ' \u00b5g/m\u00b3 \u2013 ' + A.band(r.pm25), 'big'));
    box.append(el('p', 'PM10 ' + Math.round(r.pm10) + ' \u00b7 NO\u2082 ' + Math.round(r.no2) + ' \u00b7 SO\u2082 ' + Math.round(r.so2) + ' \u00b7 CO ' + Math.round(r.co) + ' \u00b7 wind ' + Math.round(r.windSpeed) + ' km/h from the ' + A.compass(r.windDir)));
    box.append(el('p', A.protection(r.pm25), 'advice'));
    box.hidden = false;
    $('ask').hidden = false;
    askNext();
  }

  function askNext() {
    const holder = $('questions');
    holder.replaceChildren();
    const q = A.nextQuestion(state.readings, state.obs);
    $('build').hidden = false;
    if (!q) return;
    const fs = el('fieldset'); fs.append(el('legend', q.text));
    q.options.forEach(([val, label]) => {
      const l = el('label', null, 'opt'), i = document.createElement('input');
      i.type = 'radio'; i.name = q.id; i.value = val;
      i.addEventListener('change', () => { state.obs[q.id] = val; askNext(); });
      l.append(i, document.createTextNode(' ' + label)); fs.append(l);
    });
    holder.append(fs);
  }

  function showCase() {
    const result = A.rank(state.readings, state.obs);
    const box = $('case'); box.replaceChildren();
    const head = result.verdict === 'inconclusive' ? 'Not enough evidence to name a source' : (result.verdict === 'likely' ? 'Likely source: ' : 'Possible source: ') + result.top.label;
    box.append(el('h2', head));
    result.ranked.forEach((x) => {
      const row = el('div', null, 'row');
      row.append(el('span', x.label, 'lab'));
      const bar = el('span', null, 'bar'), fill = el('span'); fill.style.width = Math.round(x.confidence * 100) + '%'; bar.append(fill);
      row.append(bar, el('span', Math.round(x.confidence * 100) + '%', 'pct'));
      box.append(row);
      if (x.reasons.length) box.append(el('p', x.reasons.join('; ') + '.', 'why'));
    });
    box.append(el('p', 'This is an estimate from pollutant ratios and what you saw. It is evidence to request an inspection, not proof.', 'note'));
    const draft = A.buildComplaint({ area: state.area, when: state.when, readings: state.readings, result, obs: state.obs, notes: $('notes').value });
    const ta = el('textarea'); ta.id = 'draft'; ta.value = draft; ta.rows = 14; ta.setAttribute('aria-label', 'Complaint draft, editable');
    box.append(el('h3', 'Your complaint draft'), ta);
    const tools = el('div', null, 'tools');
    const copy = el('button', 'Copy draft'); copy.type = 'button';
    copy.addEventListener('click', () => navigator.clipboard.writeText(ta.value).then(() => status('Draft copied.'), () => status('Copy failed. Select the text and copy manually.', true)));
    const sel = el('select'); sel.id = 'lang'; sel.setAttribute('aria-label', 'Language');
    [['en', 'English'], ['hi', 'Hindi'], ['kn', 'Kannada']].forEach(([v, t]) => { const o = el('option', t); o.value = v; sel.append(o); });
    const ai = el('button', 'Translate and polish with AI'); ai.type = 'button';
    ai.addEventListener('click', async () => {
      ai.disabled = true; status('Polishing\u2026');
      try {
        const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ta.value, lang: sel.value }) });
        const raw = await r.text();
        let d = {};
        try { d = JSON.parse(raw); } catch (x) { d = { error: 'The AI service is not responding (server error ' + r.status + ').' }; }
        if (!r.ok) throw new Error(d.error || 'AI polish failed');
        ta.value = d.text; status('Polished. Check the numbers before sending.');
      } catch (e) { status(e.message + ' Your draft above is still ready to send.', true); }
      ai.disabled = false;
    });
    tools.append(copy, sel, ai); box.append(tools);
    box.hidden = false; box.scrollIntoView({ behavior: 'smooth' }); ta.focus({ preventScroll: true });
  }

  $('find').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = A.sanitize($('place').value, 80);
    if (!q) return status('Enter your locality or city first.', true);
    status('Fetching air data\u2026'); $('case').hidden = true; state.obs = {};
    try { const d = await load(q); state.area = d.area; state.when = d.when; state.readings = d.readings; status(''); showReadings(); }
    catch (err) { status(err.message, true); }
  });
  $('build').addEventListener('click', showCase);
})();
