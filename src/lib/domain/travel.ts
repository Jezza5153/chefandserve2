/**
 * Travel-cost + margin estimate — Cockpit PR-3. Pure + deterministic.
 *
 * Free estimate (no NS/maps API): straight-line × road-factor × round-trip ×
 * a per-km rate by transport mode. Tunable constants; OV labelled "NS-schatting".
 * Margin = client revenue − chef cost − travel, so the cockpit can flag
 * "best chef ≠ highest score" (a nearby good-enough chef may beat a far star).
 *
 * Upgrade seam: swap the distance source (PR-3 geo.haversineKm) or the OV rate
 * for a real routing/NS API behind these same signatures.
 */

import { haversineKm, type LatLng } from "./geo";

export type TransportMode = "car" | "motorbike" | "ebike" | "none";

const ROAD_FACTOR = 1.3; // straight-line → approximate road distance
/** €/km per mode (cents). Tunable; OV ("none") is an NS-grade per-km estimate. */
const PER_KM_CENTS: Record<TransportMode, number> = {
  car: 23,
  motorbike: 21,
  ebike: 5,
  none: 18,
};

export type TravelEstimate = {
  km: number; // one-way road estimate
  roundTripKm: number;
  costCents: number;
  mode: TransportMode;
  basis: string; // human, e.g. "auto · €0,23/km" or "OV (NS-schatting)"
};

export function estimateTravel(args: {
  from: LatLng;
  to: LatLng;
  mode?: TransportMode | null;
}): TravelEstimate {
  const mode = args.mode ?? "none";
  const straight = haversineKm(args.from, args.to);
  const km = Math.round(straight * ROAD_FACTOR * 10) / 10;
  const roundTripKm = Math.round(km * 2 * 10) / 10;
  const costCents = Math.round(roundTripKm * PER_KM_CENTS[mode]);
  const basis =
    mode === "none"
      ? "OV (NS-schatting)"
      : `${mode === "car" ? "auto" : mode === "motorbike" ? "motor" : "e-bike"} · €${(PER_KM_CENTS[mode] / 100).toFixed(2).replace(".", ",")}/km`;
  return { km, roundTripKm, costCents, mode, basis };
}

export type MarginEstimate = {
  revenueCents: number;
  chefCostCents: number;
  travelCents: number;
  marginCents: number;
  tone: "ok" | "low" | "negative";
};

/**
 * Gross margin for one shift = client revenue − chef cost − travel. Rates are
 * per-hour cents; `hours` is the shift duration. Travel is the round-trip cost.
 */
export function estimateMargin(args: {
  clientRateCents: number | null;
  chefRateCents: number | null;
  hours: number;
  travelCents: number;
}): MarginEstimate {
  const revenueCents = Math.round((args.clientRateCents ?? 0) * args.hours);
  const chefCostCents = Math.round((args.chefRateCents ?? 0) * args.hours);
  const marginCents = revenueCents - chefCostCents - args.travelCents;
  const ratio = revenueCents > 0 ? marginCents / revenueCents : 0;
  const tone: MarginEstimate["tone"] =
    marginCents < 0 ? "negative" : ratio < 0.15 ? "low" : "ok";
  return { revenueCents, chefCostCents, travelCents: args.travelCents, marginCents, tone };
}

/** €X,XX from cents (Dutch formatting). */
export function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}
