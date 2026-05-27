/**
 * ApproveOneButton — inline "Goedkeur" on a queue row.
 *
 * Wraps a server action in its OWN form (not the surrounding bulk form)
 * so submitting one doesn't accidentally submit the bulk selection.
 */

export function ApproveOneButton({
  hoursId,
  approveAction,
}: {
  hoursId: string;
  approveAction: (formData: FormData) => Promise<void> | void;
}) {
  return (
    <form action={approveAction} className="inline">
      <input type="hidden" name="hoursId" value={hoursId} />
      <button
        type="submit"
        className="rounded-full bg-emerald-600 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-emerald-700"
        title="Goedkeur direct (magic-eligible)"
      >
        ✓ Goedkeur
      </button>
    </form>
  );
}
