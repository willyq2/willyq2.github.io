// Renders monthly Baltimore Oriole migration data on a MapLibre map.
// Turf.js computes a concentration area (convex hull) and centroid
// distance for the selected month in the browser.

const FADE_MS = 260;
const PLAY_INTERVAL_MS = 1100;
const ACCENT = "#ff8c00";
const MONTH_ABBR = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

let DATA = null;
let currentMonth = 6;
let playing = false;
let playTimer = null;

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-85, 24],
  zoom: 2.4,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");

function monthPointsFC(monthKey) {
  const m = DATA.months[monthKey];
  return turf.featureCollection(m.points.map((p) => turf.point([p.lon, p.lat], { region: p.region })));
}

function fullPathFC() {
  return turf.lineString(DATA.migration_path.map((p) => [p.lon, p.lat]));
}

// Migration path is Jan..Dec..Jan. "Traveled so far" = Jan through the
// current month's vertex.
function traveledPathFC(monthKey) {
  const coords = DATA.migration_path.slice(0, Number(monthKey)).map((p) => [p.lon, p.lat]);
  return coords.length < 2 ? turf.featureCollection([]) : turf.featureCollection([turf.lineString(coords)]);
}

function concentrationHullFC(monthKey) {
  const hull = turf.convex(monthPointsFC(monthKey));
  return hull ? turf.featureCollection([hull]) : turf.featureCollection([]);
}

// Average distance from each point to the month's centroid.
function concentrationRadiusMiles(monthKey) {
  const m = DATA.months[monthKey];
  if (!m.points.length) return 0;
  const center = turf.point([m.centroid.lon, m.centroid.lat]);
  const dists = m.points.map((p) => turf.distance(turf.point([p.lon, p.lat]), center, { units: "miles" }));
  return Math.round(dists.reduce((a, b) => a + b, 0) / dists.length);
}

function renderPanel(monthKey) {
  const m = DATA.months[monthKey];
  document.getElementById("stage-badge").textContent = m.stage;
  document.getElementById("month-name").textContent = m.name;
  document.getElementById("month-note").textContent = m.note;
  document.getElementById("stat-points").textContent = m.points.length;
  document.getElementById("stat-radius").textContent = concentrationRadiusMiles(monthKey);
  document.getElementById("stat-delta").textContent = m.miles_since_last_month.toLocaleString();
}

function updateMonth(monthKey, { fade = true } = {}) {
  currentMonth = Number(monthKey);
  document.getElementById("monthSlider").value = currentMonth;
  renderPanel(monthKey);

  const apply = () => {
    map.getSource("birds").setData(monthPointsFC(monthKey));
    map.getSource("hull").setData(concentrationHullFC(monthKey));
    map.getSource("traveled").setData(traveledPathFC(monthKey));
    if (fade) {
      map.setPaintProperty("bird-circles", "circle-opacity", 0.85);
      map.setPaintProperty("hull-fill", "fill-opacity", 0.16);
    }
  };

  if (fade) {
    map.setPaintProperty("bird-circles", "circle-opacity", 0);
    map.setPaintProperty("hull-fill", "fill-opacity", 0);
    setTimeout(apply, FADE_MS);
  } else {
    apply();
  }
}

function buildTicks() {
  document.getElementById("month-ticks").innerHTML = MONTH_ABBR.map((a) => `<span>${a}</span>`).join("");
}

function togglePlay() {
  playing = !playing;
  const btn = document.getElementById("playBtn");
  btn.textContent = playing ? "❚❚" : "▶";
  btn.setAttribute("aria-label", playing ? "Pause" : "Play migration animation");
  if (playing) {
    playTimer = setInterval(() => updateMonth((currentMonth % 12) + 1), PLAY_INTERVAL_MS);
  } else {
    clearInterval(playTimer);
  }
}

async function init() {
  try {
    const res = await fetch("data/oriole_migration.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    console.error("Failed to load migration data:", err);
    document.getElementById("month-name").textContent = "Couldn't load data";
    document.getElementById("month-note").textContent = "Check that a local server is running from the project folder.";
    return;
  }

  document.getElementById("hero-number").textContent = DATA.total_annual_miles_estimate.toLocaleString();
  buildTicks();
  renderPanel(currentMonth);

  map.on("load", () => {
    map.addSource("full-path", { type: "geojson", data: fullPathFC() });
    map.addSource("traveled", { type: "geojson", data: turf.featureCollection([]) });
    map.addSource("hull", { type: "geojson", data: turf.featureCollection([]) });
    map.addSource("birds", { type: "geojson", data: turf.featureCollection([]) });

    map.addLayer({
      id: "full-path-line",
      type: "line",
      source: "full-path",
      paint: { "line-color": "gray", "line-width": 1.2, "line-dasharray": [1, 2], "line-opacity": 0.55 },
    });

    map.addLayer({
      id: "traveled-path-line",
      type: "line",
      source: "traveled",
      paint: { "line-color": ACCENT, "line-width": 2.2, "line-opacity": 0.9 },
    });

    map.addLayer({
      id: "hull-fill",
      type: "fill",
      source: "hull",
      paint: {
        "fill-color": ACCENT,
        "fill-opacity": 0,
        "fill-opacity-transition": { duration: FADE_MS },
        "fill-outline-color": ACCENT,
      },
    });

    map.addLayer({
      id: "bird-circles",
      type: "circle",
      source: "birds",
      paint: {
        "circle-radius": 4,
        "circle-color": ACCENT,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0,
        "circle-opacity-transition": { duration: FADE_MS },
      },
    });

    updateMonth(currentMonth, { fade: false });
    map.setPaintProperty("bird-circles", "circle-opacity", 0.85);
    map.setPaintProperty("hull-fill", "fill-opacity", 0.16);

    map.on("click", "bird-circles", (e) => {
      const region = e.features[0].properties.region;
      new maplibregl.Popup().setLngLat(e.features[0].geometry.coordinates).setHTML(`<b>${region}</b>`).addTo(map);
    });
    map.on("mouseenter", "bird-circles", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "bird-circles", () => (map.getCanvas().style.cursor = ""));
  });

  document.getElementById("monthSlider").addEventListener("input", (e) => {
    if (playing) togglePlay();
    updateMonth(e.target.value);
  });
  document.getElementById("playBtn").addEventListener("click", togglePlay);
}

init();
