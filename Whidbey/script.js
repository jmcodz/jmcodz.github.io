
// South Whidbey Island tides using NOAA CO-OPS Data API
// Station 9447856 — Sandy Point, Saratoga Passage
// Docs: https://api.tidesandcurrents.noaa.gov/api/prod/ (predictions, intervals)

const STATION_ID = "9447856";
const API_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const datumSel = document.getElementById('datum');
const unitsSel = document.getElementById('units');
const refreshBtn = document.getElementById('refresh');

let chart; // Chart.js instance

function fmtDate(date){
  // yyyyMMdd for API
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function localTZ(){
  // Use local station time with DST adjustments
  return 'lst_ldt';
}

function buildUrl({begin, end, product, interval, datum, units}){
  const params = new URLSearchParams({
    product,
    application: 'Jeremy.Whidbey.Tides',
    begin_date: fmtDate(begin),
    end_date: fmtDate(end),
    datum,
    station: STATION_ID,
    time_zone: localTZ(),
    units,
    format: 'json'
  });
  if (interval) params.set('interval', interval);
  return `${API_BASE}?${params.toString()}`;
}

async function fetchJSON(url){
  const resp = await fetch(url);
  if (!resp.ok){
    throw new Error(`HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (data.error){
    throw new Error(data.error.message || 'API error');
  }
  return data;
}

function last7Next7(){
  const now = new Date();
  const begin = new Date(now);
  begin.setDate(now.getDate() - 7);
  const end = new Date(now);
  end.setDate(now.getDate() + 7);
  return {begin, end};
}

function toLocalDate(s){
  // NOAA returns times in local time when using lst_ldt (we still parse to Date)
  return new Date(s.replace(' ', 'T'));
}

function setHiloNote(supportsHourly){
  const note = document.getElementById('hiloNote');
  note.textContent = supportsHourly
    ? 'Showing verified high/low times alongside hourly predictions.'
    : 'Station provides high/low predictions only; no hourly series available.';
}

async function loadData(){
  const {begin, end} = last7Next7();
  const datum = datumSel.value;
  const units = unitsSel.value;

  // Try hourly predictions first. Some subordinate stations only support hilo.
  let hourly = [];
  let supportsHourly = true;
  try {
    const urlHourly = buildUrl({
      begin,
      end,
      product: 'predictions',
      interval: '60',
      datum,
      units
    });
    const res = await fetchJSON(urlHourly);
    hourly = Array.isArray(res.predictions) ? res.predictions : [];
    if (!hourly.length) supportsHourly = false;
  } catch (e) {
    console.warn('Hourly predictions not available:', e);
    supportsHourly = false;
  }

  // Always get high/low predictions
  const urlHilo = buildUrl({
    begin,
    end,
    product: 'predictions',
    interval: 'hilo',
    datum,
    units
  });
  const hiloRes = await fetchJSON(urlHilo);
  const hilo = Array.isArray(hiloRes.predictions) ? hiloRes.predictions : [];

  setHiloNote(supportsHourly);
  renderChart(hourly, hilo, units);
  renderTable(hilo, units);
}

function renderChart(hourly, hilo, units){
  const ctx = document.getElementById('tideChart');
  const unitLabel = units === 'metric' ? 'm' : 'ft';

  // Line dataset: hourly if available; else plot Hi/Lo values as a line to visualize level changes
  const labels = (hourly.length ? hourly : hilo).map(p => toLocalDate(p.t));
  const series = (hourly.length ? hourly : hilo).map(p => Number(p.v));

  // Scatter dataset: explicit Hi/Lo markers
  const hiloPoints = hilo.map(p => ({ x: toLocalDate(p.t), y: Number(p.v), type: p.type }));

  const data = {
    labels,
    datasets: [
      {
        label: hourly.length ? `Hourly predictions (${unitLabel})` : `High/Low points (${unitLabel})`,
        data: series,
        borderColor: '#2a76d2',
        backgroundColor: 'rgba(42,118,210,0.15)',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
      },
      {
        type: 'scatter',
        label: 'High / Low markers',
        data: hiloPoints,
        borderColor: '#d27a2a',
        backgroundColor: (ctx) => {
          const t = ctx.raw.type;
          return t === 'H' ? 'rgba(25,150,25,0.9)' : 'rgba(200,60,60,0.9)';
        },
        pointRadius: 3,
        showLine: false,
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.y.toFixed(2)} ${unitLabel}`
        }
      }
    },
    scales: {
      x: {
        type: 'time',            // requires date adapter
        time: { unit: 'day' },
        ticks: { maxRotation: 0 },
      },
      y: {
        title: { display: true, text: `Height (${unitLabel})` },
        beginAtZero: false,
      }
    }
  };

  if (chart){ chart.destroy(); }
  chart = new Chart(ctx, { type: 'line', data, options });
}

function renderTable(hilo, units){
  const tbody = document.querySelector('#hiloTable tbody');
  tbody.innerHTML = '';
  const unitLabel = units === 'metric' ? 'm' : 'ft';
  for (const row of hilo){
    const dt = toLocalDate(row.t);
    const dateStr = dt.toLocaleDateString();
    const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const typeStr = row.type === 'H' ? 'High' : 'Low';
    const h = Number(row.v).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${dateStr}</td><td>${timeStr}</td><td>${typeStr}</td><td>${h} ${unitLabel}</td>`;
    tbody.appendChild(tr);
  }
}

// --- 7-Day Weather Forecast (NWS) ---
const WX_LAT = 48.035;   // Sandy Point approx (48° 2.1' N)
const WX_LON = -122.377; // (122° 22.6' W)

async function loadWeather(){
  const grid = document.getElementById('wxGrid');
  if (!grid) return;
  grid.innerHTML = '<div>Loading forecast…</div>';
  try{
    const pointsResp = await fetch(`https://api.weather.gov/points/${WX_LAT},${WX_LON}`);
    if(!pointsResp.ok) throw new Error('points lookup failed');
    const points = await pointsResp.json();
    const forecastUrl = points?.properties?.forecast || points?.properties?.forecastGridData;
    if(!forecastUrl) throw new Error('forecast URL missing');
    const fcResp = await fetch(forecastUrl);
    if(!fcResp.ok) throw new Error('forecast fetch failed');
    const fc = await fcResp.json();
    const periods = fc?.properties?.periods || [];
    const first14 = periods.slice(0, 14); // 7 days (day+night)
    grid.innerHTML = '';
    for(const p of first14){
      const card = document.createElement('div');
      card.className = 'wx-card';
      const icon = p.icon ? `<img alt="" src="${p.icon}" style="width:36px;height:36px;float:right"/>` : '';
      card.innerHTML = `
        <h3>${p.name}</h3>
        ${icon}
        <div class="temp">${p.temperature}°${p.temperatureUnit}</div>
        <div class="detail">${p.shortForecast}</div>
        <div class="detail">Winds: ${p.windSpeed} ${p.windDirection || ''}</div>
      `;
      grid.appendChild(card);
    }
  }catch(e){
    grid.innerHTML = `<div role="alert">Weather forecast unavailable (${e.message}).</div>`;
  }
}

const toggleBtn = document.getElementById('toggleTides');
const tideContainer = document.getElementById('tideContainer');

toggleBtn.addEventListener('click', () => {
  tideContainer.classList.toggle('hidden');


// --- Wire up events ---
refreshBtn?.addEventListener('click', loadData);
window.addEventListener('DOMContentLoaded', () => {
  loadData();
  loadWeather();
});
