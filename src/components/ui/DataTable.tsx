/**
 * DataTable — UX foundation. A generic, mobile-safe table with the established list-page
 * wrapper baked in (`overflow-x-auto rounded-lg border` — so it never clips columns on a
 * phone). Additive: NEW tables use this; existing hand-rolled tables are NOT retrofitted in
 * this pass (that would be a high-risk visual rewrite for no functional gain).
 * Server- and client-safe.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  headerClassName?: string;
  cellClassName?: string;
};

function alignClass(a?: "left" | "right" | "center"): string {
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  rowHref,
  empty = "Geen gegevens.",
  className = "",
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  empty?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-200 bg-white px-4 py-10 text-center text-sm text-ink-500">
        {empty}
      </div>
    );
  }
  return (
    <div className={`overflow-x-auto rounded-lg border border-ink-200 bg-white ${className}`}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink-200">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500 ${alignClass(c.align)} ${c.headerClassName ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr key={getRowKey(row)} className="border-b border-ink-100 last:border-0 hover:bg-bg-gray/40">
                {columns.map((c) => {
                  const content = c.cell(row);
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-sm text-ink-900 ${alignClass(c.align)} ${c.cellClassName ?? ""}`}
                    >
                      {href ? (
                        <Link href={href} className="block">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
