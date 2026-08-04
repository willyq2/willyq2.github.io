"""
Generates synthetic Baltimore Oriole (Icterus galbula) records in eBird
Basic Dataset (EBD) format, then aggregates them into
data/oriole_migration.json for the map.

Real eBird data requires an API key (ebird.org/data/download) and isn't
used here. Point locations are simulated: each month is modeled as a set
of weighted regional clusters (breeding range, migration corridor,
wintering range), with points scattered around each cluster center.
Monthly notes are paraphrased from Journey North's Baltimore Oriole
annual-cycle page (journeynorth.org).

Outputs:
  data/ebd_sample_synthetic.txt  -- EBD-format rows (tab-delimited)
  data/oriole_migration.json     -- aggregated monthly data for the map
"""
import csv
import json
import math
import random

random.seed(42)

EBD_COLUMNS = [
    "GLOBAL UNIQUE IDENTIFIER", "COMMON NAME", "SCIENTIFIC NAME",
    "OBSERVATION COUNT", "COUNTRY", "STATE", "LOCALITY",
    "LATITUDE", "LONGITUDE", "OBSERVATION DATE", "OBSERVER ID",
    "SAMPLING EVENT IDENTIFIER", "PROTOCOL TYPE", "ALL SPECIES REPORTED",
]
PROTOCOLS = ["Traveling", "Stationary", "Incidental"]

# month: [(lon, lat, spread_deg, weight, region), ...]
MONTHS = {
    1: {"name": "January", "stage": "wintering",
        "note": "The year begins in the tropics, in mixed flocks at good feeding trees.",
        "clusters": [(-73, 8, 2.5, .35, "Colombia"), (-82, 9, 2.0, .25, "Panama"),
                     (-77, 19, 2.2, .20, "Cuba"), (-81.5, 27.5, 1.2, .20, "Florida")]},
    2: {"name": "February", "stage": "wintering",
        "note": "Still on the wintering grounds; early migrants begin moving through Panama.",
        "clusters": [(-73, 8, 2.5, .35, "Colombia"), (-82, 9, 2.0, .25, "Panama"),
                     (-77, 19, 2.2, .20, "Cuba"), (-81.5, 27.5, 1.2, .20, "Florida")]},
    3: {"name": "March", "stage": "migration",
        "note": "Some reach Mexico; many are still as far south as Panama.",
        "clusters": [(-90, 18, 2.5, .45, "Mexico"), (-77, 12, 2.5, .40, "Central America"),
                     (-73, 9, 2.0, .15, "Colombia")]},
    4: {"name": "April", "stage": "migration",
        "note": "Peak migration begins. First arrivals reach Texas; a few reach the central states by month's end.",
        "clusters": [(-97, 28, 1.5, .25, "Texas"), (-90, 32, 2.5, .30, "Louisiana"),
                     (-95, 20, 2.5, .30, "Mexico"), (-88, 40, 2.0, .15, "Illinois")]},
    5: {"name": "May", "stage": "arrival",
        "note": "Orioles reach the northern states and provinces — peak month for nest-building.",
        "clusters": [(-88, 42, 2.5, .30, "Michigan"), (-75, 42, 2.0, .20, "New York"),
                     (-97, 41, 2.5, .20, "Nebraska"), (-80, 37, 2.0, .15, "Virginia"),
                     (-92, 49, 2.5, .15, "Manitoba")]},
    6: {"name": "June", "stage": "breeding",
        "note": "Most eggs hatch this month; parents incubate and feed young.",
        "clusters": [(-87, 43, 2.5, .28, "Michigan"), (-98, 41, 2.5, .25, "Nebraska"),
                     (-73, 43, 2.0, .20, "New York"), (-97, 51, 2.5, .15, "Saskatchewan"),
                     (-78, 39, 1.8, .12, "Virginia")]},
    7: {"name": "July", "stage": "breeding",
        "note": "Fledglings become independent; some adults begin migrating as early as the start of the month.",
        "clusters": [(-87, 43, 2.5, .27, "Michigan"), (-98, 41, 2.5, .23, "Nebraska"),
                     (-73, 43, 2.0, .18, "New York"), (-97, 51, 2.5, .12, "Saskatchewan"),
                     (-78, 39, 1.8, .10, "Virginia"), (-90, 33, 2.0, .10, "Arkansas")]},
    8: {"name": "August", "stage": "migration",
        "note": "Migration builds toward its peak, which spans August and September.",
        "clusters": [(-88, 40, 2.5, .35, "Illinois"), (-90, 33, 2.5, .30, "Arkansas"),
                     (-95, 29, 2.0, .35, "Texas")]},
    9: {"name": "September", "stage": "migration",
        "note": "Migration continues at its peak.",
        "clusters": [(-96, 27, 2.0, .35, "Texas"), (-95, 19, 2.5, .30, "Mexico"),
                     (-89, 16, 2.0, .20, "Guatemala"), (-85, 34, 2.0, .15, "Georgia")]},
    10: {"name": "October", "stage": "migration",
         "note": "Migration eases in the first half of the month; most reach tropical wintering grounds.",
         "clusters": [(-84, 11, 2.5, .30, "Costa Rica"), (-73, 8, 2.5, .25, "Colombia"),
                      (-90, 17, 2.0, .20, "Mexico"), (-77, 19, 2.0, .20, "Cuba"),
                      (-82, 28, 1.2, .05, "Florida")]},
    11: {"name": "November", "stage": "wintering",
         "note": "Mostly in the tropics, though a few linger in northern states and provinces.",
         "clusters": [(-73, 8, 2.5, .35, "Colombia"), (-82, 9, 2.0, .25, "Panama"),
                      (-77, 19, 2.2, .20, "Cuba"), (-81.5, 27.5, 1.2, .15, "Florida"),
                      (-90, 18, 1.5, .05, "Mexico")]},
    12: {"name": "December", "stage": "wintering",
         "note": "Nearly the entire population is in the tropics.",
         "clusters": [(-73, 8, 2.5, .35, "Colombia"), (-82, 9, 2.0, .25, "Panama"),
                      (-77, 19, 2.2, .20, "Cuba"), (-81.5, 27.5, 1.2, .20, "Florida")]},
}

POINTS_PER_MONTH = 70
YEAR = 2025


def haversine_miles(lon1, lat1, lon2, lat2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def sim_points(clusters, n):
    weights = [c[3] for c in clusters]
    points = []
    for _ in range(n):
        lon, lat, spread, _, region = random.choices(clusters, weights=weights, k=1)[0]
        points.append({
            "lon": round(lon + random.gauss(0, spread), 3),
            "lat": round(lat + random.gauss(0, spread * 0.75), 3),
            "region": region,
        })
    return points


def ebd_row(point, month, obs_id):
    day = random.randint(1, 28)
    return {
        "GLOBAL UNIQUE IDENTIFIER": f"URN:CornellLabOfOrnithology:EBIRD:OBS{obs_id}",
        "COMMON NAME": "Baltimore Oriole",
        "SCIENTIFIC NAME": "Icterus galbula",
        "OBSERVATION COUNT": random.randint(1, 4),
        "COUNTRY": "",
        "STATE": point["region"],
        "LOCALITY": point["region"],
        "LATITUDE": point["lat"],
        "LONGITUDE": point["lon"],
        "OBSERVATION DATE": f"{YEAR}-{month:02d}-{day:02d}",
        "OBSERVER ID": f"obsr{random.randint(1000000, 9999999)}",
        "SAMPLING EVENT IDENTIFIER": f"S{random.randint(100000000, 999999999)}",
        "PROTOCOL TYPE": random.choice(PROTOCOLS),
        "ALL SPECIES REPORTED": 1,
    }


def main():
    ebd_rows = []
    months_out = {}
    centroids = {}
    obs_id = 1000000000

    for m, info in MONTHS.items():
        points = sim_points(info["clusters"], POINTS_PER_MONTH)
        for p in points:
            ebd_rows.append(ebd_row(p, m, obs_id))
            obs_id += 1

        clon = sum(p["lon"] for p in points) / len(points)
        clat = sum(p["lat"] for p in points) / len(points)
        centroids[m] = (clon, clat)
        months_out[str(m)] = {
            "name": info["name"], "stage": info["stage"], "note": info["note"],
            "centroid": {"lon": round(clon, 3), "lat": round(clat, 3)},
            "points": points,
        }

    for m in range(1, 13):
        prev = 12 if m == 1 else m - 1
        c1, c2 = centroids[prev], centroids[m]
        months_out[str(m)]["miles_since_last_month"] = round(haversine_miles(c1[0], c1[1], c2[0], c2[1]))

    path = [{"lon": round(centroids[m][0], 3), "lat": round(centroids[m][1], 3)} for m in range(1, 13)]
    path.append(path[0])
    total_miles = sum(months_out[str(m)]["miles_since_last_month"] for m in range(1, 13))

    with open("data/ebd_sample_synthetic.txt", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=EBD_COLUMNS, delimiter="\t")
        writer.writeheader()
        writer.writerows(ebd_rows)

    with open("data/oriole_migration.json", "w") as f:
        json.dump({
            "species": {"common_name": "Baltimore Oriole", "scientific_name": "Icterus galbula"},
            "total_annual_miles_estimate": total_miles,
            "migration_path": path,
            "months": months_out,
        }, f, indent=2)

    print(f"Wrote {len(ebd_rows)} EBD rows and 12 months, ~{total_miles} mi annual round trip")


if __name__ == "__main__":
    main()
