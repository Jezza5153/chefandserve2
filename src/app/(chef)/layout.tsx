import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { SignOutLink } from "@/app/(admin)/_components/SignOutLink";
import { AssistantWidget } from "@/components/ai/AssistantWidget";
import { ChefNav } from "@/components/chef/ChefNav";
import { InstallPrompt } from "@/components/chef/InstallPrompt";
import { LanguageToggle } from "@/components/chef/LanguageToggle";
import { PwaRegistrar } from "@/components/chef/PwaRegistrar";
import { ConsentGate } from "@/components/ConsentGate";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { aiEnabled, chefAiChatEnabled } from "@/lib/ai/config";
import { hasCurrentConsent, isConsentEnforced, recordConsent } from "@/lib/consent";
import { getLocale, i18nEnabled } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { requireAuth } from "@/lib/permissions";

export const metadata: Metadata = {
  title: { default: "Chef portal", template: "%s · Chef & Serve" },
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Chef & Serve" },
};

export const viewport: Viewport = { themeColor: "#801B2B" };

/**
 * Chef portal layout — mobile-first. Chefs view this on their phone.
 * Simple top nav (no sidebar). Bottom-pinned account section.
 */
async function acceptChefConsent() {
  "use server";
  const session = await requireAuth();
  const h = await headers();
  await recordConsent({
    userId: session.user.id,
    kind: "chef",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  });
  revalidatePath("/chef");
}

export default async function ChefLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();
  const consented = await hasCurrentConsent({
    userId: session.user.id,
    kind: "chef",
  });
  const locale = await getLocale();
  const showLanguageToggle = i18nEnabled();

  return (
    <LocaleProvider locale={locale}>
    <div className="flex min-h-screen flex-col bg-bg-gray">
      <ImpersonationBanner session={session} />
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/chef"
              className="font-serif text-xl tracking-[0.04em] text-ink-900"
            >
              Chef <span className="text-burgundy">&amp;</span> Serve
            </Link>
            <div className="flex items-center gap-4">
              {showLanguageToggle ? <LanguageToggle /> : null}
              <NotificationBell
                userId={session.user.id}
                notificationsHref="/chef/notifications"
              />
              <div className="text-right">
                <p className="font-ui text-xs uppercase tracking-[0.2em] text-ink-500">
                  {session.user.name ?? session.user.email}
                </p>
                <SignOutLink />
              </div>
            </div>
          </div>
          <ChefNav />
        </div>
      </header>

      <main className="flex-1">
        {/* pb-24 on mobile clears the fixed bottom tab bar; normal on md+ */}
        <div className="mx-auto max-w-3xl px-4 pb-24 pt-8 md:pb-8">{children}</div>
      </main>

      {!consented ? (
        <ConsentGate
          enforce={isConsentEnforced()}
          privacyHref="/privacy-chef"
          acceptAction={acceptChefConsent}
        />
      ) : null}

      {/* Chef AI chat is OFF by default (CHEF_AI_CHAT_ENABLED). Chefs get AI help
          indirectly — CV-driven profile suggestions + completeness nudges. */}
      {aiEnabled() && chefAiChatEnabled() && session.user.kind === "chef" ? (
        <AssistantWidget
          endpoint="/api/ai/portal/chat"
          subtitle="Je hulp"
          placeholder="Stel een vraag, bijvoorbeeld: “wanneer werk ik?” of “welke uren moet ik nog invullen?”"
        />
      ) : null}

      <PwaRegistrar />
      <InstallPrompt />
    </div>
    </LocaleProvider>
  );
}
