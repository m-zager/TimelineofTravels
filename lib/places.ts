// Names the place at a point on the globe, offline: the US state inside the US, otherwise the
// country, or the nearest one for a point in the ocean. Uses the same map data as the globe.

import { geoContains, geoDistance } from "d3-geo";
import type { Feature, Geometry, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const COUNTRIES_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json";
const USA = "United States of America";

// world-atlas abbreviates some names, and us-atlas spells a couple out at length.
const DISPLAY_NAMES: Record<string, string> = {
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Central African Rep.": "Central African Republic",
  "Dem. Rep. Congo": "Democratic Republic of the Congo",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Falkland Is.": "Falkland Islands",
  "Fr. S. Antarctic Lands": "French Southern and Antarctic Lands",
  Macedonia: "North Macedonia",
  "N. Cyprus": "Northern Cyprus",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  [USA]: "United States",
  "W. Sahara": "Western Sahara",
  eSwatini: "Eswatini",
  "Commonwealth of the Northern Mariana Islands": "Northern Mariana Islands",
  "United States Virgin Islands": "U.S. Virgin Islands",
};

type Named = { name: string };
type Region = { name: string; shape: Feature<Geometry, Named>; outline: Position[] };
export type Places = { countries: Region[]; states: Region[] };
/** `inside`: the point is in the place; otherwise it's the nearest one (e.g. in the ocean). */
export type Place = { name: string; inside: boolean };

let placesPromise: Promise<Places> | undefined;

// Every vertex of a region's outline, for finding the nearest region to a point.
function outlinePoints(geometry: Geometry): Position[] {
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

async function loadRegions(url: string, object: string): Promise<Region[]> {
  const topo = (await (await fetch(url)).json()) as Topology<Record<string, GeometryCollection<Named>>>;
  return feature(topo, topo.objects[object]).features.map((shape) => ({
    name: shape.properties.name,
    shape,
    outline: outlinePoints(shape.geometry),
  }));
}

/** Loads the map data once; later calls reuse it. A failed load is retried next time. */
export function loadPlaces(): Promise<Places> {
  placesPromise ??= Promise.all([loadRegions(COUNTRIES_URL, "countries"), loadRegions(STATES_URL, "states")])
    .then(([countries, states]) => ({ countries, states }))
    .catch((err) => {
      placesPromise = undefined;
      throw err;
    });
  return placesPromise;
}

function nearest(regions: Region[], point: [number, number]): Region {
  let best = regions[0];
  let bestDistance = Infinity;
  for (const region of regions) {
    for (const vertex of region.outline) {
      const distance = geoDistance(point, vertex as [number, number]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = region;
      }
    }
  }
  return best;
}

export function placeAt({ countries, states }: Places, lat: number, lon: number): Place {
  const point: [number, number] = [lon, lat];
  const display = (name: string) => DISPLAY_NAMES[name] ?? name;

  // The state outlines are more detailed than the world's, so check them first.
  const state = states.find((region) => geoContains(region.shape, point));
  if (state) return { name: display(state.name), inside: true };

  const country = countries.find((region) => geoContains(region.shape, point));
  if (country) {
    // A US point that falls between the coarse world outline and the state outlines.
    const name = country.name === USA ? nearest(states, point).name : country.name;
    return { name: display(name), inside: true };
  }

  const closest = nearest(countries, point);
  const name = closest.name === USA ? nearest(states, point).name : closest.name;
  return { name: display(name), inside: false };
}
