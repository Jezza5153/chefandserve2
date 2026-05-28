/**
 * Geocoding — Cockpit PR-3. Free, keyless NL geocoding via PDOK Locatieserver
 * (the Dutch government address service). No API key, no cost. Used to turn a
 * chef's postcode (+ house number) and a shift's city into coordinates so the
 * cockpit can show "8 km away ≈ €12 reiskosten".
 *
 * Network is best-effort: any failure returns null and callers degrade (the
 * distance/margin chip simply doesn't show). Upgrade seam: swap in a routing
 * API behind `haversineKm` later for real road distance.
 */

const PDOK_FREE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

export type LatLng = { lat: number; lng: number };

function parseCentroid(doc: unknown): LatLng | null {
  const ll = (doc as { centroide_ll?: unknown })?.centroide_ll;
  if (typeof ll !== "string") return null;
  // PDOK returns "POINT(lng lat)".
  const m = ll.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function pdok(query: string, typeFilter: string): Promise<LatLng | null> {
  const url = `${PDOK_FREE}?q=${encodeURIComponent(query)}&fq=type:${typeFilter}&rows=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: { docs?: unknown[] } };
    const doc = json?.response?.docs?.[0];
    return doc ? parseCentroid(doc) : null;
  } catch {
    return null;
  }
}

/** Geocode a NL postcode (+ optional house number) to coordinates. */
export async function geocodeNL(
  postcode: string | null | undefined,
  houseNumber?: string | null,
): Promise<LatLng | null> {
  if (!postcode) return null;
  const pc = postcode.replace(/\s+/g, "").toUpperCase();
  if (!/^\d{4}[A-Z]{2}$/.test(pc)) return geocodeCity(postcode); // not a postcode → try as place
  const q = houseNumber ? `${pc} ${houseNumber}` : pc;
  return pdok(q, "adres");
}

/** Coarser fallback: geocode a city/place name (for shifts without a postcode). */
export async function geocodeCity(city: string | null | undefined): Promise<LatLng | null> {
  if (!city) return null;
  return pdok(city.trim(), "woonplaats");
}

/** Great-circle distance in km. Road distance ≈ this × ~1.3 (see travel.ts). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
