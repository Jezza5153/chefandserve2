/**
 * Chef profile-change decisions — the shared core behind BOTH the admin review UI
 * (the chefs/[id] page server action) and the owner AI assistant's approve/reject
 * tools.
 *
 * A chef requests a change to one master field (naam, e-mail, vakniveau, uurtarief)
 * via the portal; an owner/planner decides. Approving applies the proposed value to
 * the chefs master record (and mirrors an e-mail change through to the login user)
 * and flips the request → approved; rejecting only records the decision. Either way
 * the chef gets an outcome e-mail.
 *
 * Plain domain function (no "use server") so callers wrap it after resolving the
 * session → permission. Mirrors decideShiftChangeRequest: stampFromRequest OUTSIDE
 * the tx, recordAuditCore INSIDE it (decision + master-field write commit together),
 * e-mail post-commit. stampFromRequest no-ops outside a request scope.
 */
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import { chefs, profileChangeRequests, users, vakniveauEnum } from "@/lib/db/schema";
import { isValidEmail } from "@/lib/forms/validation";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import {
  chefChangeFieldLabel,
  formatChefChangeValue,
} from "@/lib/chef-profile-change-labels";

export type ProfileChangeDecideError =
  | "request-gone"
  | "ongeldig-vakniveau"
  | "ongeldig-emailadres"
  | "emailadres-in-gebruik";

export type DecideChefProfileChangeResult =
  | {
      ok: true;
      decision: "approved" | "rejected";
      field: string;
      fieldLabel: string;
      chefName: string;
      emailed: boolean;
    }
  | { ok: false; reason: ProfileChangeDecideError };

/** Human (Dutch) sentence for a decide error — the AI tools throw this back to the brain. */
export function profileChangeErrorNl(reason: ProfileChangeDecideError): string {
  switch (reason) {
    case "request-gone":
      return "dit verzoek bestaat niet meer of is al behandeld";
    case "ongeldig-vakniveau":
      return "het voorgestelde vakniveau is ongeldig";
    case "ongeldig-emailadres":
      return "het voorgestelde e-mailadres is ongeldig";
    case "emailadres-in-gebruik":
      return "dat e-mailadres is al in gebruik";
  }
}

/**
 * Decide one chef profile-change request. `expectChefId` constrains the request to a
 * given chef (the admin page is scoped to one chef); omit it from the assistant,
 * which decides by request id alone. Returns a discriminated result — callers map it
 * to a redirect (page) or a thrown Dutch message (tools).
 */
export async function decideChefProfileChange(args: {
  requestId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  decisionNotes?: string | null;
  expectChefId?: string | null;
}): Promise<DecideChefProfileChangeResult> {
  const { requestId, decidedBy, decision, expectChefId } = args;
  const decisionNotes = (args.decisionNotes ?? "").trim() || null;

  const [req] = await db
    .select()
    .from(profileChangeRequests)
    .where(eq(profileChangeRequests.id, requestId))
    .limit(1);
  if (
    !req ||
    req.status !== "pending" ||
    (expectChefId != null && req.chefId !== expectChefId)
  ) {
    return { ok: false, reason: "request-gone" };
  }

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, req.chefId) });
  if (!chef) return { ok: false, reason: "request-gone" };

  // Validate the proposed value BEFORE applying (no raw DB throw on bad input).
  // Only relevant on approval — a rejection writes no master-table field.
  const pv = req.proposedValue as unknown;
  const proposedEmail =
    decision === "approved" && req.field === "email"
      ? String(pv ?? "").trim().toLowerCase()
      : null;
  if (decision === "approved") {
    if (req.field === "vakniveau") {
      // vakniveau is a pg enum — reject anything outside it (avoids a 22P02).
      if (!(vakniveauEnum.enumValues as readonly string[]).includes(String(pv))) {
        return { ok: false, reason: "ongeldig-vakniveau" };
      }
    } else if (req.field === "email" && proposedEmail) {
      if (!isValidEmail(proposedEmail)) {
        return { ok: false, reason: "ongeldig-emailadres" };
      }
      // Uniqueness against the login table (users.email is UNIQUE — a clash would
      // 500 inside the tx). Exclude the chef's own linked user.
      const clash = await db
        .select({ id: users.id })
        .from(users)
        .where(
          chef.userId
            ? and(eq(users.email, proposedEmail), ne(users.id, chef.userId))
            : eq(users.email, proposedEmail),
        )
        .limit(1);
      if (clash.length > 0) {
        return { ok: false, reason: "emailadres-in-gebruik" };
      }
    }
  }

  // Atomic: flip the status + apply the master field in ONE tx (so a partial apply
  // can't outlive a failed/stale transition). Audit commits in the same tx.
  const auditBase = await stampFromRequest({
    userId: decidedBy,
    action:
      decision === "approved"
        ? "chef.profile_change_approved"
        : "chef.profile_change_rejected",
    resource: "profile_change_requests",
    resourceId: requestId,
    after: { field: req.field, decision, decisionNotes },
  });
  const result = await withTx(async (tx) => {
    // Guard first: only a still-pending request flips. Zero rows → stale.
    const flipped = await tx
      .update(profileChangeRequests)
      .set({
        status: decision,
        decidedAt: new Date(),
        decidedBy,
        decisionNotes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(profileChangeRequests.id, requestId),
          eq(profileChangeRequests.status, "pending"),
        ),
      )
      .returning({ id: profileChangeRequests.id });
    if (flipped.length === 0) return { ok: false as const };

    // Apply the validated proposed value (only when approved).
    if (decision === "approved") {
      if (req.field === "hourlyRate" && pv && typeof pv === "object") {
        const { min, max } = pv as { min?: number; max?: number };
        await tx
          .update(chefs)
          .set({
            hourlyRateMinCents: typeof min === "number" ? min : null,
            hourlyRateMaxCents: typeof max === "number" ? max : null,
            updatedAt: new Date(),
          })
          .where(eq(chefs.id, chef.id));
      } else if (req.field === "fullName") {
        await tx
          .update(chefs)
          .set({ fullName: String(pv), updatedAt: new Date() })
          .where(eq(chefs.id, chef.id));
      } else if (req.field === "email" && proposedEmail) {
        await tx
          .update(chefs)
          .set({ email: proposedEmail, updatedAt: new Date() })
          .where(eq(chefs.id, chef.id));
        // Keep the portal-login email in sync — chefs.email is the login address
        // (mirrored to users.email at invite time), so an approved email change
        // must follow through to users or login silently drifts.
        if (chef.userId) {
          await tx
            .update(users)
            .set({ email: proposedEmail, updatedAt: new Date() })
            .where(eq(users.id, chef.userId));
        }
      } else if (req.field === "vakniveau") {
        await tx
          .update(chefs)
          .set({ vakniveau: String(pv) as never, updatedAt: new Date() })
          .where(eq(chefs.id, chef.id));
      }
    }

    await recordAuditCore(auditBase, tx);
    return { ok: true as const };
  });
  if (!result.ok) return { ok: false, reason: "request-gone" };

  // Outcome e-mail to the chef (direct — chefs have no recipientsFor seam).
  let emailed = false;
  if (chef.email) {
    const fieldLabel = chefChangeFieldLabel(req.field);
    const send = await sendEmail({
      to: chef.email,
      subject:
        decision === "approved"
          ? `Wijziging doorgevoerd: ${fieldLabel}`
          : `Wijzigingsverzoek niet doorgevoerd: ${fieldLabel}`,
      react: (
        <div>
          <h1>
            {decision === "approved"
              ? "Je wijziging is doorgevoerd"
              : "Je wijzigingsverzoek is niet doorgevoerd"}
          </h1>
          <p>
            <strong>Onderdeel:</strong> {fieldLabel}
            {decision === "approved" ? (
              <>
                <br />
                <strong>Nieuwe waarde:</strong>{" "}
                {formatChefChangeValue(req.field, req.proposedValue)}
              </>
            ) : null}
            {decisionNotes ? (
              <>
                <br />
                <strong>Toelichting van Chef &amp; Serve:</strong> {decisionNotes}
              </>
            ) : null}
          </p>
          <p>Vragen? Mail of bel het kantoor — we helpen je graag.</p>
        </div>
      ),
    });
    if (send.ok) {
      emailed = true;
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: chef.email,
        template: "ChefProfileChangeOutcomeInline",
        eventKey: "profile_change_request",
        entityType: "profile_change_requests",
        entityId: requestId,
        userId: chef.userId ?? undefined,
      });
    }
  }

  return {
    ok: true,
    decision,
    field: req.field,
    fieldLabel: chefChangeFieldLabel(req.field),
    chefName: chef.fullName,
    emailed,
  };
}
