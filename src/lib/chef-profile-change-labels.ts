/**
 * Pure labels/formatters for chef profile-change requests — the field's human name
 * and a display string for its value. Shared by the admin review UI
 * (ChangeRequests.tsx), the page's decide action, the domain decision function
 * (chef-profile-changes.tsx) and the assistant's read/act tools, so every surface
 * speaks about a change the same way. No deps → safe to import anywhere (mirrors
 * hours-labels / client-shift-labels). Relocated verbatim from ChangeRequests.tsx.
 */
export function chefChangeFieldLabel(field: string): string {
  return (
    {
      fullName: "Naam",
      email: "E-mailadres",
      vakniveau: "Vakniveau",
      hourlyRate: "Uurtarief",
    } as Record<string, string>
  )[field] ?? field;
}

export function formatChefChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "hourlyRate" && typeof value === "object") {
    const { min, max } = value as { min?: number; max?: number };
    const fmt = (c?: number) => (typeof c === "number" ? `€${(c / 100).toFixed(0)}` : "—");
    return `${fmt(min)} – ${fmt(max)} per uur`;
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}
