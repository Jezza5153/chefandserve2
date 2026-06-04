"use client";

import { useState, useTransition } from "react";

import { submitContactAction } from "./actions";

const FIELD =
  "w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream";
const LABEL = "mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream";

type Values = { name: string; company: string; email: string; phone: string; role: string; message: string };

export function ContactForm() {
  const [v, setV] = useState<Values>({ name: "", company: "", email: "", phone: "", role: "", message: "" });
  const [hp, setHp] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function set(k: keyof Values, val: string) {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => {
      if (!e[k]) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
  }

  function submit() {
    setFlash(null);
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = "Vul je naam in.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Vul een geldig e-mailadres in.";
    if (!v.message.trim()) e.message = "Vul een bericht in.";
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }
    start(async () => {
      const res = await submitContactAction({ ...v, __hp: hp });
      if (res.ok) {
        setDone(true);
      } else if (res.error === "rate_limited") {
        setFlash("Je hebt te veel berichten verstuurd. Probeer het later opnieuw of bel ons.");
      } else if ("fieldErrors" in res && res.fieldErrors) {
        setErrors(res.fieldErrors);
      } else {
        setFlash("Versturen mislukt. Probeer het opnieuw.");
      }
    });
  }

  if (done) {
    return (
      <div className="self-start rounded border border-cream/30 bg-white/5 p-8 text-center md:col-span-7">
        <p className="font-serif text-2xl text-white">✓ Bedankt voor je bericht!</p>
        <p className="mt-2 text-sm text-white/80">We nemen binnen een uur contact op tijdens werkdagen.</p>
      </div>
    );
  }

  const errEl = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-cream">{errors[k]}</p> : null);

  return (
    <div className="grid gap-4 md:col-span-7 md:grid-cols-2">
      {flash ? (
        <p className="rounded border border-cream/40 bg-white/5 px-4 py-2 text-sm text-cream md:col-span-2">{flash}</p>
      ) : null}

      <div className="md:col-span-1">
        <label htmlFor="name" className={LABEL}>Naam</label>
        <input id="name" type="text" value={v.name} onChange={(e) => set("name", e.target.value)} className={FIELD} />
        {errEl("name")}
      </div>

      <div className="md:col-span-1">
        <label htmlFor="company" className={LABEL}>Bedrijf / Locatie</label>
        <input id="company" type="text" value={v.company} onChange={(e) => set("company", e.target.value)} className={FIELD} />
      </div>

      <div className="md:col-span-1">
        <label htmlFor="email" className={LABEL}>E-mail</label>
        <input id="email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} className={FIELD} />
        {errEl("email")}
      </div>

      <div className="md:col-span-1">
        <label htmlFor="phone" className={LABEL}>Telefoon</label>
        <input id="phone" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} className={FIELD} />
      </div>

      <div className="md:col-span-2">
        <label htmlFor="role" className={LABEL}>Welke rol zoekt u?</label>
        <select id="role" value={v.role} onChange={(e) => set("role", e.target.value)} className={FIELD}>
          <option value="" className="text-ink-900">Maak een keuze...</option>
          <option value="chef" className="text-ink-900">Chef / Sous chef / Chef de partie</option>
          <option value="kok" className="text-ink-900">Kok / Commis / Keukenhulp</option>
          <option value="bediening" className="text-ink-900">Bediening / Host / Runner</option>
          <option value="banqueting" className="text-ink-900">Banqueting / Catering / Event</option>
          <option value="hotel" className="text-ink-900">Hotel personeel</option>
          <option value="overig" className="text-ink-900">Overig / nog niet zeker</option>
        </select>
      </div>

      <div className="md:col-span-2">
        <label htmlFor="message" className={LABEL}>Bericht</label>
        <textarea
          id="message"
          rows={5}
          value={v.message}
          onChange={(e) => set("message", e.target.value)}
          placeholder="Periode, aantal personen, segment (casual / fine dining / hotel) en eventuele bijzonderheden."
          className={FIELD}
        />
        {errEl("message")}
      </div>

      {/* honeypot — hidden from humans */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div className="md:col-span-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-full bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:bg-cream disabled:opacity-50"
        >
          {pending ? "Versturen…" : "Verstuur bericht"}
        </button>
        <p className="mt-3 text-xs text-white/50">
          Door dit formulier te versturen gaat u akkoord met ons{" "}
          <a href="/privacybeleid/" className="text-white underline">privacybeleid</a>.
        </p>
      </div>
    </div>
  );
}
