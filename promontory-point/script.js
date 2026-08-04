// ============================================================
// Promontory Point — Revetment Removal Plan
//
// Loads two raw files (tree inventory CSV + citywide parks GeoJSON)
// and does all the geospatial work in the browser with Turf.js:
// find the Point, build a 75ft ring around it, keep the water-facing
// slice of that ring, and check which trees fall inside it.
// ============================================================

const BUFFER_FT = 75; // how far the work zone extends from the shoreline
const CLIP_PAD_DEG = 0.0015; // ~150m padding used to crop Burnham Park down to just the Point

// Where the water-facing arc starts/ends, as a percent of the way around
// the Point's outline (0% = northernmost vertex). Confirmed by eye against
// the rendered map — if the underlying data ever changes shape enough to
// need rechecking, try a value, reload, and watch the red zone.
const START_PCT = 0;
const END_PCT = 57;

const COLOR_RETAIN = "#5a7350";
const COLOR_REMOVE = "#a03228";

// Supersample the exported image beyond the screen's native resolution, for
// a sharper result than a straight screenshot. 3 is a reasonable ceiling —
// past that you start risking a device's max texture size on a large screen.
const EXPORT_PIXEL_RATIO = 3;

// ---- Map ----
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-87.5786, 41.7961],
  zoom: 16,
  preserveDrawingBuffer: true, // needed so the canvas can be exported as an image
});
map.addControl(new maplibregl.NavigationControl());

// ---- CSV -> GeoJSON ----
// csv2geojson handles the actual parsing (including this file's oddities,
// like doubled line-endings); this just keeps the columns the page uses,
// under simpler names, and skips any row missing a valid lat/lon.
function parseTreesCSV(text) {
  let trees;
  csv2geojson.csv2geojson(text, { latfield: "Latitude", lonfield: "Longitude" }, (err, data) => {
    if (err) console.warn("Some CSV rows were skipped:", err);
    trees = data;
  });

  for (const tree of trees.features) {
    const p = tree.properties;
    tree.properties = {
      id: p["Primary ID"],
      common: p["Common Name"],
      latin: p["Latin Name"],
      dbh: parseFloat(p.DBH) || 0,
      removalCategory: "retain",
    };
  }
  return trees;
}

// ---- Find the Point ----
// Promontory Point has no park record of its own — it's part of Burnham
// Park, which runs ~8km along the lakefront. Pull Burnham Park out of the
// citywide file by name, crop it to the tree inventory's bounding box,
// then keep the larger of the two resulting pieces (a small gap splits
// the Point from the connecting lakefront path).
function findBurnhamPark(parksFC) {
  const park = parksFC.features.find((f) => f.properties.label === "Burnham");
  if (!park) throw new Error('Could not find a park with label "Burnham".');
  return park;
}

function findPointPolygon(burnhamFeature, treeBbox) {
  const clipBox = [
    treeBbox[0] - CLIP_PAD_DEG,
    treeBbox[1] - CLIP_PAD_DEG,
    treeBbox[2] + CLIP_PAD_DEG,
    treeBbox[3] + CLIP_PAD_DEG,
  ];
  const clipped = turf.bboxClip(burnhamFeature, clipBox);

  // bboxClip leaves empty placeholder pieces for parts that didn't overlap
  // the box — turf.flatten splits the MultiPolygon into individual
  // features, and filtering by area drops those empty ones. What's left
  // is the largest real piece: the Point itself.
  const pieces = turf.flatten(clipped).features.filter((f) => turf.area(f) > 0);
  return pieces.sort((a, b) => turf.area(b) - turf.area(a))[0];
}

// ---- Build the revetment zone ----
// 1. Shrink a copy of the Point inward by 75ft and subtract that from the
//    original — what's left is a ring hugging every edge equally (water
//    side and road side alike).
// 2. Walk the Point's outline as one loop and keep only the ring between
//    START_PCT and END_PCT of the way around, isolating the water side.
function buildRevetmentZone(pointPolygon) {
  try {
    const inner = turf.buffer(pointPolygon, -BUFFER_FT, { units: "feet" });
    const ring = inner ? turf.difference(pointPolygon, inner) : pointPolygon;
    if (!ring) return null;

    const outline = turf.polygonToLine(pointPolygon);
    const totalFeet = turf.length(outline, { units: "feet" });
    const arc = turf.lineSliceAlong(outline, (totalFeet * START_PCT) / 100, (totalFeet * END_PCT) / 100, {
      units: "feet",
    });
    const arcArea = turf.buffer(arc, BUFFER_FT, { units: "feet" });

    // Rounding coordinates avoids a floating-point edge case where
    // turf's intersect can throw.
    return turf.intersect(turf.truncate(ring, { precision: 7 }), turf.truncate(arcArea, { precision: 7 }));
  } catch (err) {
    return null;
  }
}

// ---- Classify trees + update the sidebar ----
function classifyTrees(treesFC, revetmentZone) {
  for (const tree of treesFC.features) {
    const inZone = Boolean(revetmentZone) && turf.booleanPointInPolygon(tree, revetmentZone);
    tree.properties.removalCategory = inZone ? "remove_revetment" : "retain";
  }
}

function countBySpecies(trees) {
  const counts = {};
  for (const tree of trees) {
    const name = tree.properties.common || "Unknown";
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]); // most-affected species first
}

function updateSidebar(treesFC) {
  const total = treesFC.features.length;
  const removed = treesFC.features.filter((t) => t.properties.removalCategory === "remove_revetment");

  document.getElementById("stats").innerHTML = `
    <div><b>${total}</b> trees on the Point</div>
    <div><b>${removed.length}</b> in the removal zone</div>
    <div><b>${((removed.length / total) * 100).toFixed(1)}%</b> of inventory</div>
  `;

  const rows = countBySpecies(removed);
  document.getElementById("breakdown").innerHTML = rows.length
    ? rows.map(([name, count]) => `<div class="breakdown-row"><span>${name}</span><span>${count}</span></div>`).join("")
    : `<p class="hint">No trees fall in the current zone.</p>`;
}

// ---- Export helpers ----
// Triggers a browser download by creating a temporary link and clicking it.
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function treesToCSV(treesFC) {
  const header = "id,common_name,latin_name,dbh_inches,status,latitude,longitude";
  const rows = treesFC.features.map((t) => {
    const p = t.properties;
    const [lon, lat] = t.geometry.coordinates;
    const status = p.removalCategory === "remove_revetment" ? "removed" : "kept";
    return [p.id, p.common, p.latin, p.dbh, status, lat, lon].join(",");
  });
  return [header, ...rows].join("\n");
}

// ---- Legend, drawn onto the exported image ----
// map.getCanvas() only captures the map's own pixels, not the HTML
// sidebar, so the legend needs to be drawn directly onto a copy of the
// canvas to show up in the downloaded image.
function radiusForDbh(dbh) {
  // Mirrors the tree-circles layer's circle-radius expression below
  // (0in -> 3px, 40in -> 14px), so the legend's example circles are
  // actually the right size, not just illustrative.
  return 3 + (14 - 3) * (Math.min(dbh, 40) / 40);
}

function drawLegend(ctx, canvasWidth, canvasHeight, dpr) {
  const pad = 12 * dpr;
  const rowHeight = 22 * dpr;
  const sectionGap = 14 * dpr; // extra breathing room between the color rows and the size scale
  const scaleRowHeight = 46 * dpr;
  const width = 240 * dpr;
  const height = rowHeight * 2 + sectionGap + scaleRowHeight + pad * 2;
  const x = canvasWidth - width - 16 * dpr;
  const y = canvasHeight - height - 16 * dpr;

  // A soft white outline behind each bit of text, so it stays legible
  // sitting directly on the map — water, land, and tree circles are all
  // different colors underneath, and there's no background box anymore.
  ctx.lineJoin = "round";
  function haloText(text, tx, ty) {
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.strokeText(text, tx, ty);
    ctx.fillText(text, tx, ty);
  }

  const rows = [
    { color: COLOR_RETAIN, label: "Retained" },
    { color: COLOR_REMOVE, label: "Removed (revetment zone)" },
  ];
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  rows.forEach((row, i) => {
    const rowY = y + pad + rowHeight * i + rowHeight / 2;
    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(x + pad + 5 * dpr, rowY, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = `bold ${14 * dpr}px -apple-system, sans-serif`;
    haloText(row.label, x + pad + 16 * dpr, rowY);
  });

  // Size scale: a few example circles at real DBH values, actual size —
  // set apart from the color rows above by sectionGap
  const scaleY = y + pad + rowHeight * 2 + sectionGap;
  const baseline = scaleY + 22 * dpr;
  const spacing = 58 * dpr;
  ctx.textAlign = "center";
  [5, 20, 40].forEach((dbh, i) => {
    const cx = x + pad + 14 * dpr + spacing * i;
    const r = radiusForDbh(dbh) * dpr;
    ctx.strokeStyle = "#666";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(cx, baseline - r, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#555";
    ctx.font = `${11 * dpr}px -apple-system, sans-serif`;
    haloText(`${dbh}"`, cx, baseline + 10 * dpr);
  });
  ctx.textAlign = "left";
  haloText("Trunk diameter (DBH)", x + pad, scaleY + 40 * dpr);
}

map.on("load", async () => {
  document.getElementById("bufferLabel").textContent = `${BUFFER_FT}ft`;

  const [csvText, parksFC] = await Promise.all([
    fetch("data/Promontory_Point_2023_Complete_10052023.csv").then((res) => res.text()),
    fetch("data/CPD_Parks_20260729.geojson").then((res) => res.json()),
  ]);

  const trees = parseTreesCSV(csvText);
  const treeBbox = turf.bbox(trees); // footprint of the tree inventory = footprint of the Point
  const pointPolygon = findPointPolygon(findBurnhamPark(parksFC), treeBbox);

  // Keep only trees actually on the Point — the same inventory export also
  // covers the lakefront path west of the road, which isn't part of this
  // analysis.
  trees.features = trees.features.filter((t) => turf.booleanPointInPolygon(t, pointPolygon));

  const revetmentZone = buildRevetmentZone(pointPolygon);
  classifyTrees(trees, revetmentZone);

  map.addSource("boundary", { type: "geojson", data: pointPolygon });
  map.addSource("revetment-zone", { type: "geojson", data: revetmentZone || turf.featureCollection([]) });
  map.addSource("trees", { type: "geojson", data: trees });

  map.addLayer({
    id: "revetment-fill",
    type: "fill",
    source: "revetment-zone",
    paint: { "fill-color": COLOR_REMOVE, "fill-opacity": 0.25, "fill-outline-color": COLOR_REMOVE },
  });

  map.addLayer({
    id: "boundary-line",
    type: "line",
    source: "boundary",
    paint: { "line-color": "#2b2417", "line-width": 1.5 },
  });

  map.addLayer({
    id: "tree-circles",
    type: "circle",
    source: "trees",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "dbh"], 0, 3, 40, 14], // size = trunk diameter
      "circle-color": ["match", ["get", "removalCategory"], "remove_revetment", COLOR_REMOVE, COLOR_RETAIN],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#2b2417",
      "circle-opacity": 0.85,
    },
  });

  map.on("click", "tree-circles", (e) => {
    const p = e.features[0].properties;
    const status = p.removalCategory === "remove_revetment" ? "Removed" : "Retained";
    new maplibregl.Popup()
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`<b>${p.common}</b><br><i>${p.latin}</i><br>DBH: ${p.dbh}in<br>Status: ${status}<br>ID: ${p.id}`)
      .addTo(map);
  });
  map.on("mouseenter", "tree-circles", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "tree-circles", () => (map.getCanvas().style.cursor = ""));

  updateSidebar(trees);

  document.getElementById("downloadDataBtn").addEventListener("click", () => {
    downloadFile("promontory_point_trees.csv", treesToCSV(trees), "text/csv");
  });

  // The image button is disabled until the map has fully finished
  // rendering ("idle"), so the export isn't missing tiles that were
  // still loading.
  const downloadImageBtn = document.getElementById("downloadImageBtn");
  map.once("idle", () => {
    downloadImageBtn.disabled = false;
  });
  downloadImageBtn.addEventListener("click", () => {
    downloadImageBtn.disabled = true; // avoid double-clicks mid-export

    // Temporarily render at a higher resolution than the screen actually
    // needs, then capture that — sharper than just screenshotting what's
    // already on screen. map.once("idle") waits for that re-render to
    // actually finish before capturing (a plain screenshot right after
    // setPixelRatio can catch the canvas mid-resize, before it's repainted).
    const originalPixelRatio = window.devicePixelRatio || 1;
    map.setPixelRatio(EXPORT_PIXEL_RATIO);

    map.once("idle", () => {
      const mapCanvas = map.getCanvas();
      const dpr = mapCanvas.width / map.getContainer().clientWidth; // true buffer-to-CSS-pixel ratio right now
      const side = Math.min(mapCanvas.width, mapCanvas.height); // crop to a centered square

      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = side;
      outputCanvas.height = side;
      const ctx = outputCanvas.getContext("2d");
      ctx.drawImage(
        mapCanvas,
        (mapCanvas.width - side) / 2,
        (mapCanvas.height - side) / 2,
        side,
        side,
        0,
        0,
        side,
        side
      );
      drawLegend(ctx, side, side, dpr);

      const link = document.createElement("a");
      link.href = outputCanvas.toDataURL("image/png");
      link.download = "promontory_point_map.png";
      link.click();

      map.setPixelRatio(originalPixelRatio); // back to normal for on-screen use
      downloadImageBtn.disabled = false;
    });
  });
});