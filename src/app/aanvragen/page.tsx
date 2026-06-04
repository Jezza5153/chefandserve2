import { redirect } from "next/navigation";

/**
 * Short alias for the public klant intake form (PR-K2-1).
 * Canonical URL is /horeca-personeel-aanvragen.
 */
export default function AanvragenAlias() {
  redirect("/horeca-personeel-aanvragen");
}
