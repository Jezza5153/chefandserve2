"use client";

import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * CHEF-PR3 — Aankomstzekerheid (Arrival Trust), privacy-first.
 *
 * In the 20 minutes before the shift, the phone watches its own location, computes
 * the distance to the job-site HERE (client-side haversine), and POSTs ONLY the
 * result event to /api/chef/arrival — never coordinates, never a route. Stops once
 * "nearby" is confirmed. Best-effort: permission denied / no signal degrade
 * gracefully (and never blame the chef). Job-site lat/lng are the chef's own shift's
 * coordinates (not sensitive); the chef's position never leaves the device.
 */
type Props = { shiftId: string; startsAtMs: number; lat: number; lng: number };
type State = "idle" | "monitoring" | "nearby" | "permission" | "no_signal";

const WINDOW_BEFORE_MS = 20 * 60 * 1000;
const WINDOW_AFTER_MS = 30 * 60 * 1000;
const NEARBY_KM = 1;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function ArrivalTrust({ shiftId, startsAtMs, lat, lng }: Props) {
  const t = useT();
  const [state, setState] = useState<State>("idle");
  const postedRef = useRef(false);

  useEffect(() => {
    const post = (event: string) => {
      void fetch("/api/chef/arrival", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId, event }),
      }).catch(() => {});
    };

    let watchId: number | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setState("no_signal");
        return;
      }
      setState("monitoring");
      post("monitoring");
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (postedRef.current) return;
          const km = distanceKm(pos.coords.latitude, pos.coords.longitude, lat, lng);
          if (km <= NEARBY_KM) {
            postedRef.current = true;
            post("nearby"); // only the result — NOT the position
            setState("nearby");
            if (watchId != null) navigator.geolocation.clearWatch(watchId);
          }
        },
        (err) => {
          if (postedRef.current) return;
          if (err.code === err.PERMISSION_DENIED) {
            postedRef.current = true;
            post("permission_missing");
            setState("permission");
          } else {
            setState("no_signal");
          }
        },
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
      );
    };

    const now = Date.now();
    const opensAt = startsAtMs - WINDOW_BEFORE_MS;
    const closesAt = startsAtMs + WINDOW_AFTER_MS;
    if (now >= opensAt && now <= closesAt) {
      start();
    } else if (now < opensAt) {
      startTimer = setTimeout(start, Math.min(opensAt - now, 2_147_000_000));
    }

    return () => {
      if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
      if (startTimer) clearTimeout(startTimer);
    };
  }, [shiftId, startsAtMs, lat, lng]);

  const headline =
    state === "nearby"
      ? t.shiftDetail.arrival.statusNearby
      : state === "monitoring"
        ? t.shiftDetail.arrival.statusMonitoring
        : state === "permission"
          ? t.shiftDetail.arrival.statusPermission
          : state === "no_signal"
            ? t.shiftDetail.arrival.statusNoSignal
            : t.shiftDetail.arrival.statusReady;

  return (
    <section className="mt-6 rounded-lg border border-burgundy/20 bg-burgundy/5 p-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block size-2 rounded-full ${state === "nearby" ? "bg-emerald-500" : state === "monitoring" ? "animate-pulse bg-burgundy" : "bg-ink-300"}`}
        />
        <p className="font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-burgundy">
          {t.shiftDetail.arrival.label}
        </p>
      </div>
      <p className="mt-2 text-sm font-medium text-ink-900">{headline}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
        {t.shiftDetail.arrival.description}
      </p>
    </section>
  );
}
