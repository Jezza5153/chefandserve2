/**
 * Dashboard loading skeleton — the control room previously rendered NOTHING until all
 * ~27 queries resolved, so a panic visit stared at a blank page. Next.js streams this
 * shell instantly while the server component fetches; in a 09:40 emergency the first
 * paint is the difference between "it's working" and "it's broken, call someone".
 */
const CARD = "rounded-xl border border-ink-200 bg-white";
const PULSE = "animate-pulse rounded bg-ink-100";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6" aria-busy="true" aria-label="Dashboard laden">
      {/* greeting + toolbar */}
      <div className={`${PULSE} h-8 w-64`} />
      <div className="mt-5 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${PULSE} h-9 w-28 rounded-full`} />
        ))}
      </div>
      {/* bezetting cards */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={`${CARD} h-28 p-5`}><div className={`${PULSE} h-4 w-24`} /><div className={`${PULSE} mt-3 h-8 w-40`} /></div>
        <div className={`${CARD} h-28 p-5`}><div className={`${PULSE} h-4 w-24`} /><div className={`${PULSE} mt-3 h-8 w-40`} /></div>
      </div>
      {/* main table + rail */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className={`${CARD} h-72 p-5`}>
          <div className={`${PULSE} h-5 w-44`} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${PULSE} mt-4 h-10 w-full`} />
          ))}
        </div>
        <div className="space-y-5">
          <div className={`${CARD} h-40 p-5`}><div className={`${PULSE} h-5 w-32`} /><div className={`${PULSE} mt-4 h-20 w-full`} /></div>
          <div className={`${CARD} h-40 p-5`}><div className={`${PULSE} h-5 w-32`} /><div className={`${PULSE} mt-4 h-20 w-full`} /></div>
        </div>
      </div>
    </div>
  );
}
