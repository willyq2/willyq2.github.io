# Promontory Point — Revetment Removal Plan

## Files

```
index.html                                       — page structure, sidebar, loads the other files
style.css                                         — all the visual styling
script.js                                         — map logic AND the geospatial work (heavily commented)
data/Promontory_Point_2023_Complete_10052023.csv  — the tree inventory, exactly as downloaded (776 trees)
data/CPD_Parks_20260729.geojson                   — Chicago Park District's full citywide parks
                                                     export, exactly as downloaded (617 parks)
```

Both data files are used untouched, at their original filenames. `script.js`
pulls Burnham Park out of the citywide file itself (`findBurnhamPark()`) — no
pre-trimming, no renaming, nothing done outside the browser.

## What changed from the original plan

The original version expected three pre-built files (`trees.geojson`,
`boundary.geojson`, `revetment-zone.geojson`) that never got generated —
that was the missing piece. Rather than regenerate those in Python and bake
in a fixed 75ft buffer, **all the geospatial work now happens live in
`script.js`**, using [Turf.js](https://turfjs.org/) for the geometry and
[csv2geojson](https://github.com/mapbox/csv2geojson) for the CSV parsing
(both loaded from a CDN the same way MapLibre is):

1. The tree CSV is converted straight into GeoJSON points by csv2geojson,
   which also skips any row missing a valid lat/lon
   (`parseTreesCSV()`).
2. Burnham Park's record is pulled out of the citywide parks file by name
   (`findBurnhamPark()`) — Promontory Point doesn't have its own park
   record, it's just part of Burnham Park's polygon, which runs ~8km
   along the lakefront.
3. That polygon is cropped down to the Point's own footprint using the
   tree inventory's bounding box, and only the larger of the two
   resulting pieces is kept — a small gap splits the actual Point from
   the connecting lakefront path (`findPointPolygon()`).
4. A copy of the Point is shrunk inward by 75ft and subtracted from the
   original (`turf.buffer` with a negative distance, then
   `turf.difference`). What's left is a **ring** — a uniform 75ft-wide
   band hugging every edge of the Point, water side and road side alike.
5. The ring covers both sides equally, but only the water side is the
   actual work zone. The code walks the Point's own outline as one
   continuous loop, starting at its northernmost vertex (0%), and keeps
   only the ring up to `END_PCT` (`57`) of the way around — roughly where
   the shoreline curves back toward the road near the south end.
   `START_PCT`/`END_PCT` are fixed constants near the top of `script.js`.
   Because this follows the Point's true outline (not a straight line
   approximation), it hugs the water correctly however the shoreline
   curves.

   **Getting to these two numbers took a few wrong turns, worth noting
   in case the underlying data ever changes:** a straight line between
   the Point's northernmost/southernmost vertices was tried first, and a
   fixed pair of percentages (`8`/`82`) after that — both checked out
   cleanly in isolated testing, but both still showed the zone reaching
   onto the road once actually viewed in the browser. The root cause was
   the same one that caused the very first version of this project to
   leak: classifying "water side" vs. "road side" by a single longitude
   threshold doesn't hold up in the narrower southern stretch of the
   Point, where road and water sit close together in longitude — a
   threshold loose enough to catch the true shoreline further north ends
   up including a stretch of road further south too. `0`/`57` were
   confirmed by eye against the rendered map instead, and `57` lands
   almost exactly on the Point's own southernmost vertex.
6. Each tree is tested against the resulting shape
   (`turf.booleanPointInPolygon`) and labeled removed vs. retained
   (`classifyTrees()`), then the sidebar — including the trees-by-species
   breakdown — is redrawn from that (`updateSidebar()`).

Nothing is pre-computed or baked in, and there's nothing to tune — reload
the page and the zone, the tree colors, the stats, and the species
breakdown all build themselves from the raw data.

## Sidebar: trees being removed

The sidebar lists every species with at least one tree in the current
removal zone, sorted by count (most-affected species first) — e.g. "Sugar
maple — 18". This comes from `countBySpecies()` in `script.js`, which just
tallies `common` name across whichever trees are currently flagged
`remove_revetment`. Percentages in the stats above it are out of the 499
trees on the Point, not the full 776-tree inventory.

## Map styling

The basemap is OpenFreeMap's "positron" style — light and minimal, so it
doesn't compete visually with the red/green tree data on top. ("liberty",
a more detailed style with colored parks/water/buildings, is one line
away in `script.js` if you want that look back — see the chat for the
full rundown of available styles.) On top of that: three of our own
layers — the Point's outline, the revetment zone (solid fill with a
matching outline), and the trees themselves as flat-colored circles sized
by trunk diameter (DBH).

## Trees on the Point only

The tree inventory export also covers the lakefront path west of Lake
Shore Drive/South Shore Drive — not part of Promontory Point itself. Once
the Point's boundary is known, the code filters the tree list down to just
the 499 trees that actually fall inside it
(`turf.booleanPointInPolygon`, right after `findPointPolygon()` in the
`map.on("load", ...)` handler) — the other 277 are dropped entirely,
before anything renders, gets counted, or gets exported. All the stats,
the species breakdown, the map, and the CSV export are scoped to just
these 499.

## Export buttons

- **Download tree data (CSV)** — every tree currently on the Point, with
  a `status` column (`removed`/`kept`) alongside its species, DBH, ID, and
  coordinates. Built by `treesToCSV()`; useful for taking the dataset into
  Python/pandas for further analysis.
- **Download map image (PNG)** — captures the map exactly as it's
  currently framed (whatever zoom/pan you've set) using
  `map.getCanvas().toDataURL()`. Disabled until the map finishes its
  initial render, so the export doesn't come back missing tiles.
  `preserveDrawingBuffer: true` on the map constructor is what makes this
  possible — without it, WebGL clears the canvas after each frame and
  there's nothing to capture.

## Changing the buffer width

Edit `BUFFER_FT` near the top of `script.js` (currently `75`). No Python,
no regeneration step — just save and reload.

## You still need to run a local server, not just double-click index.html

`script.js` uses `fetch()` to load the CSV and GeoJSON files, and browsers
block `fetch()` on `file://` pages. Serve the folder over `http://`:

**Option A — VS Code's Live Server extension**
1. Install "Live Server" (by Ritwick Dey) from the Extensions panel
2. Right-click `index.html` → "Open with Live Server"

**Option B — Python's built-in server**
```bash
cd promontory-point-map
python3 -m http.server 8000
```
Then open `http://localhost:8000`.

## Known limitations

The clipped boundary splits into two separate pieces near the Point (a
small gap — likely a cove or inlet — separates the connecting lakefront
path from the Point itself). Only the larger piece (the actual Point) is
used, both for the zone calculation and for which trees count at all (see
"Trees on the Point only" above). If you want that connecting stretch
included too, `buildRevetmentZone()` would work on it unchanged — it
would just need its own `START_PCT`/`END_PCT` pair for the second
polygon piece, and the tree filter would need to keep both pieces instead
of just the larger one.

`START_PCT`/`END_PCT` (currently `0`/`57`) are specific to this data. If
the tree inventory or the parks file changes enough to shift the Point's
shape or size, these may need re-checking — the quickest way is to try a
few values, reload, and watch whether the red zone still hugs the water
without reaching the road.
