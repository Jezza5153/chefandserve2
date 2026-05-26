import { signOut } from "@/lib/auth";

/**
 * Sign-out link rendered as a server-action form submit.
 * No client component needed.
 */
export function SignOutLink() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-700 hover:text-burgundy"
      >
        ← Uitloggen
      </button>
    </form>
  );
}
