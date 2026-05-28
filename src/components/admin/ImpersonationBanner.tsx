/**
 * Impersonation banner (Phase B) — always visible while a super_admin is
 * viewing AS another user. Reads the EFFECTIVE session's `impersonator` marker
 * (set by `applyImpersonation`). The Stop button is a native form POST to
 * `/api/impersonate/stop`, which works regardless of the effective role.
 *
 * Phase B1 is view-only, so the banner says "acties uitgeschakeld".
 */

import type { Session } from "next-auth";

export function ImpersonationBanner({
  session,
  writesEnabled = false,
}: {
  session: Session;
  /** When true (B2-covered surface, e.g. chef portal), actions are allowed and
   *  audit-logged to the real super_admin. Otherwise the surface is view-only. */
  writesEnabled?: boolean;
}) {
  const imp = session.user.impersonator;
  if (!imp) return null;

  const roleLabel =
    session.user.kind === "chef"
      ? "Chef"
      : session.user.kind === "client"
        ? "Klant"
        : "Team";

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-burgundy px-4 py-2 text-white">
      <p className="font-ui text-[12px]">
        <span className="font-semibold uppercase tracking-[0.12em]">Bekijk als</span>{" "}
        — je ziet het scherm van{" "}
        <span className="font-semibold">{session.user.name ?? session.user.email}</span>{" "}
        ({roleLabel}) ·{" "}
        {writesEnabled
          ? "acties worden op jouw naam vastgelegd"
          : "acties uitgeschakeld"}
      </p>
      <form method="POST" action="/api/impersonate/stop">
        <button
          type="submit"
          className="rounded-full bg-white/15 px-3 py-1 font-ui text-[11px] font-medium uppercase tracking-[0.12em] text-white hover:bg-white/25"
        >
          Stop
        </button>
      </form>
    </div>
  );
}
