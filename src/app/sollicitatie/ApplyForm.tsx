"use client";

import { useMemo, useState, useTransition } from "react";

import { validateForm } from "@/lib/forms/validation";
import type { FieldDTO, FormDTO, FormSubmitValue } from "@/lib/forms/types";

import { submitApplicationAction } from "./actions";

const INPUT =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-400 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";

export function ApplyForm({ form }: { form: FormDTO }) {
  const fields = useMemo(() => form.sections.flatMap((s) => s.fields), [form]);
  const [values, setValues] = useState<Record<string, FormSubmitValue>>(() => {
    const v: Record<string, FormSubmitValue> = {};
    for (const f of fields) v[f.key] = null;
    return v;
  });
  const [hp, setHp] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function setV(k: string, val: FormSubmitValue) {
    setValues((s) => ({ ...s, [k]: val }));
    setErrors((e) => {
      if (!e[k]) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
  }

  function submit() {
    setFlash(null);
    const errs = validateForm(fields, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    start(async () => {
      const res = await submitApplicationAction({ ...values, __hp: hp });
      if (res.ok) {
        setDone(true);
      } else if (res.error === "rate_limited") {
        setFlash("Je hebt te veel aanvragen verstuurd. Probeer het later opnieuw of mail ons.");
      } else if ("fieldErrors" in res && res.fieldErrors) {
        setErrors(res.fieldErrors);
      } else {
        setFlash("Versturen mislukt. Probeer het opnieuw.");
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="font-serif text-xl text-emerald-900">✓ Bedankt voor je aanmelding!</p>
        <p className="mt-2 text-sm text-emerald-800">
          We nemen binnen één werkdag contact met je op voor een korte kennismaking.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-6">
      {flash ? (
        <p className="mb-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">{flash}</p>
      ) : null}
      <div className="grid gap-4">
        {fields.map((f) => (
          <div key={f.id}>{renderField(f)}</div>
        ))}
        {/* honeypot — hidden from humans */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
          aria-hidden="true"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-5 w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900 disabled:opacity-50"
      >
        {pending ? "Versturen…" : "Aanmelding versturen"}
      </button>
      <p className="mt-3 text-center text-xs text-ink-400">
        We gebruiken je gegevens alleen om contact op te nemen. Gevoelige gegevens vragen we pas later, beveiligd.
      </p>
    </div>
  );

  function renderField(field: FieldDTO) {
    const err = errors[field.key];
    const value = values[field.key];
    const label = (
      <label className="block font-ui text-[13px] font-medium text-ink-800">
        {field.label}
        {field.required ? <span className="text-burgundy"> *</span> : null}
      </label>
    );
    const help = field.helpText ? <p className="mt-1 text-xs text-ink-500">{field.helpText}</p> : null;
    const errEl = err ? <p className="mt-1 text-xs text-red-700">{err}</p> : null;

    if (field.type === "select") {
      return (
        <div>
          {label}
          {help}
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setV(field.key, e.target.value || null)}
            className={`mt-1.5 ${INPUT}`}
          >
            <option value="">— Kies —</option>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errEl}
        </div>
      );
    }

    if (field.type === "textarea") {
      return (
        <div>
          {label}
          {help}
          <textarea
            rows={3}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder ?? ""}
            onChange={(e) => setV(field.key, e.target.value)}
            className={`mt-1.5 ${INPUT}`}
          />
          {errEl}
        </div>
      );
    }

    const inputType = field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text";
    return (
      <div>
        {label}
        {help}
        <input
          type={inputType}
          value={value === null || value === undefined ? "" : String(value)}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => setV(field.key, e.target.value)}
          className={`mt-1.5 ${INPUT}`}
        />
        {errEl}
      </div>
    );
  }
}
