import { fieldClass } from "@/components/forms/Fields";
import type { Shift } from "@/lib/db/schema";

/**
 * PR-CHEF-2b — three note channels with explicit visibility.
 *
 * Action-bearing section: the `updateShiftNotes` "use server" action stays in
 * page.tsx (it closes over the shift id / request); only this form markup is
 * relocated, receiving the action as a prop (same name → moved JSX stays
 * character-identical). Mirrors the action-as-prop pattern in chefs'
 * DocumentUploader. Wrapper is `p-6`, so DetailSection (p-5) is intentionally
 * NOT used here — the card chrome must stay pixel-identical.
 */
export function NotesForm({
  updateShiftNotes,
  shift,
}: {
  updateShiftNotes: (formData: FormData) => Promise<void>;
  shift: Shift;
}) {
  return (
    <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Notities
      </h2>
      <form action={updateShiftNotes} className="mt-4 space-y-4">
        <input type="hidden" name="shiftId" value={shift.id} />
        <label className="block">
          <span className="block text-[13px] font-medium text-ink-800">
            Intern · alleen Chef &amp; Serve
          </span>
          <span className="mb-1 block text-xs text-ink-500">
            Nooit zichtbaar voor chef of klant.
          </span>
          <textarea
            name="notes"
            rows={2}
            defaultValue={shift.notes ?? ""}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="block text-[13px] font-medium text-ink-800">
            Zichtbaar voor chef
          </span>
          <span className="mb-1 block text-xs text-ink-500">
            Werkinstructies — getoond op het shift-voorstel.
          </span>
          <textarea
            name="chefVisibleNotes"
            rows={2}
            defaultValue={shift.chefVisibleNotes ?? ""}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="block text-[13px] font-medium text-ink-800">
            Zichtbaar voor klant
          </span>
          <span className="mb-1 block text-xs text-ink-500">
            Optionele info voor de klant.
          </span>
          <textarea
            name="clientVisibleNotes"
            rows={2}
            defaultValue={shift.clientVisibleNotes ?? ""}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
        >
          Notities opslaan
        </button>
      </form>
    </section>
  );
}
