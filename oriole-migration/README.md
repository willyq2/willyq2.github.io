# Baltimore Oriole — Annual Migration

Interactive map of Baltimore Oriole seasonal distribution. A month
slider updates sample sightings, a concentration area (convex hull),
and a migration route, computed client-side with Turf.js.

## Data

`generate_data.py` produces synthetic records in eBird Basic Dataset
(EBD) format — the same column structure as a real eBird export — since
real eBird data requires an API key (ebird.org/data/download). Monthly
regional clusters and notes are based on Cornell's All About Birds,
Birds of the World, and Journey North's Baltimore Oriole annual cycle.

Outputs:
- `data/ebd_sample_synthetic.txt` — synthetic EBD-format rows
- `data/oriole_migration.json` — aggregated monthly data the map loads

To regenerate: `python3 generate_data.py`

## Files

```
index.html                     page structure
style.css                      styles
script.js                      map logic + Turf.js spatial computation
generate_data.py               builds the dataset
data/oriole_migration.json     data the page loads
data/ebd_sample_synthetic.txt  synthetic EBD-format source rows
```

## Running

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000`. (Needs an HTTP server — `fetch()` is
blocked on `file://` pages.)

## Notes

- Concentration area uses a convex hull. A real production version would
  likely use a kernel density estimate or alpha shape to avoid a hull
  skewed by outlier points.
- Annual mileage is estimated from month-to-month centroid distance, not
  a tracked-bird distance.
