/**
 * Contact-log timeline — when/how Maarten last reached a chef or klant. Reads the
 * lightweight `contact_logs` ops log (channel · outcome · note), newest first. Read-only.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, contactLogs } from "@/lib/db/schema";

export async function contactTimeline(args: {
  targetType: "chef" | "client";
  targetId: string;
  limit: number;
}) {
  let name: string | null = null;
  if (args.targetType === "chef") {
    const [c] = await db.select({ name: chefs.fullName }).from(chefs).where(eq(chefs.id, args.targetId)).limit(1);
    if (!c) return null;
    name = c.name;
  } else {
    const [c] = await db.select({ name: clients.companyName }).from(clients).where(eq(clients.id, args.targetId)).limit(1);
    if (!c) return null;
    name = c.name;
  }

  const entries = await db
    .select({
      channel: contactLogs.channel,
      outcome: contactLogs.outcome,
      note: contactLogs.note,
      at: contactLogs.createdAt,
    })
    .from(contactLogs)
    .where(and(eq(contactLogs.targetType, args.targetType), eq(contactLogs.targetId, args.targetId)))
    .orderBy(desc(contactLogs.createdAt))
    .limit(args.limit);

  return { target: { type: args.targetType, id: args.targetId, name }, entries };
}
