"use client";

import { useMemo, useState, useTransition } from "react";

import { FileUploader } from "@/components/forms/FileUploader";
import { validateForm } from "@/lib/forms/validation";
import type { FieldDTO, FormDTO, FormSubmitValue } from "@/lib/forms/types";

import { requestOnboardingUpload, saveDraftAction, submitOnboardingAction } from "./actions";
import type { OnboardingInitial } from "@/lib/domain/onboarding";

const INPUT =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-400 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";

export function OnboardingWizard({
  form,
  initial,
  submitted,
  r2Configured,
}: {
  form: FormDTO;
  initial: OnboardingInitial;
  submitted: boolean;
  r2Configured: boolean;
}) {
  const fields = useMemo(() => form.sections.flatMap((s) => s.fields), [form]);

  const [values, setValues] = useState<Record<string, FormSubmitValue>>(() => {
    const v: Record<string, FormSubmitValue> = {};
    for (const f of fields) v[f.key] = initial[f.key]?.value ?? (f.type === "multiselect" ? [] : null);
    return v;
  });
  const [files, setFiles] = useState<Record<string, { documentId?: string; filename?: string }>>(() => {
    const m: Record<string, { documentId?: string; filename?: string }> = {};
    for (const f of fields) if (initial[f.key]?.filename) m[f.key] = { filename: initial[f.key]!.filename! };
    return m;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [done, setDone] = useState(submitted);
  const [pending, startTransition] = useTransition();

  const prefilled = useMemo(
    () => new Set(fields.filter((f) => initial[f.key]?.filled).map((f) => f.key)),
    [fields, initial],
  );

  function docIds(): Record<string, string | null> {
    const d: Record<string, string | null> = {};
    for (const f of fields) {
      if (f.type === "file") d[f.key] = files[f.key]?.documentId || initial[f.key]?.filled ? "present" : null;
    }
    return d;
  }

  const requiredFields = fields.filter((f) => f.required && f.type !== "heading");
  const satisfiedCount = requiredFields.filter((f) => {
    if (f.type === "file") return Boolean(files[f.key]?.documentId || initial[f.key]?.filled);
    if (prefilled.has(f.key)) return true;
    const v = values[f.key];
    return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
  }).length;
  const pct = requiredFields.length ? Math.round((satisfiedCount / requiredFields.length) * 100) : 100;

  function setValue(key: string, val: FormSubmitValue) {
    setValues((s) => ({ ...s, [key]: val }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function scrollToFirstError(errs: Record<string, string>) {
    const firstKey = fields.find((f) => errs[f.key])?.key;
    if (firstKey) document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleSave() {
    setFlash(null);
    startTransition(async () => {
      const res = await saveDraftAction(values);
      if (res.ok) {
        setErrors({});
        setFlash({ kind: "ok", msg: "Concept opgeslagen. Je kunt later verder." });
      } else if ("fieldErrors" in res && res.fieldErrors) {
        setErrors(res.fieldErrors);
        setFlash({ kind: "err", msg: "Sommige ingevulde velden kloppen nog niet." });
        scrollToFirstError(res.fieldErrors);
      } else {
        setFlash({ kind: "err", msg: "Opslaan mislukt. Probeer het opnieuw." });
      }
    });
  }

  function handleSubmit() {
    setFlash(null);
    const clientErrors = validateForm(fields, values, docIds(), prefilled);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFlash({ kind: "err", msg: "Controleer de gemarkeerde velden." });
      scrollToFirstError(clientErrors);
      return;
    }
    startTransition(async () => {
      const res = await submitOnboardingAction(values);
      if (res.ok) {
        setDone(true);
        setErrors({});
        setFlash({ kind: "ok", msg: "Onboarding ingediend — bedankt! Maarten neemt het over." });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if ("fieldErrors" in res && res.fieldErrors) {
        setErrors(res.fieldErrors);
        setFlash({ kind: "err", msg: "Controleer de gemarkeerde velden." });
        scrollToFirstError(res.fieldErrors);
      } else {
        setFlash({ kind: "err", msg: "Versturen mislukt. Probeer het opnieuw." });
      }
    });
  }

  const readOnly = done;

  return (
    <div className="pb-28">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Onboarding</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{form.title}</h1>
      {form.description ? <p className="mt-2 max-w-2xl text-sm text-ink-600">{form.description}</p> : null}

      {done ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <p className="font-serif text-lg text-emerald-900">✓ Je gegevens zijn ingediend</p>
          <p className="mt-1 text-sm text-emerald-800">
            Bedankt! Wil je iets aanpassen? Neem contact op met kantoor — zij werken je gegevens bij.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-500">
              Voortgang verplichte velden
            </span>
            <span className="font-ui text-[11px] font-medium text-ink-700">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-200">
            <div className="h-full bg-burgundy transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {flash ? (
        <p
          className={`mt-4 rounded border px-4 py-2 text-sm ${
            flash.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-burgundy/30 bg-burgundy/5 text-burgundy"
          }`}
        >
          {flash.msg}
        </p>
      ) : null}

      <div className="mt-6 space-y-6">
        {form.sections.map((section) => (
          <section key={section.id} className="rounded-lg border border-ink-200 bg-white p-5">
            <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{section.title}</h2>
            {section.description ? <p className="mt-1 text-xs text-ink-500">{section.description}</p> : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {section.fields.map((field) => (
                <div
                  key={field.id}
                  id={`field-${field.key}`}
                  className={field.type === "textarea" || field.type === "heading" ? "md:col-span-2" : ""}
                >
                  {renderField(field)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {!done ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-ink-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:border-burgundy/40 disabled:opacity-50"
            >
              Bewaar concept
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending}
              className="rounded-full bg-burgundy px-6 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900 disabled:opacity-50"
            >
              {pending ? "Bezig…" : "Verstuur onboarding"}
            </button>
          </div>
        </div>
      ) : null}
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
    const filledHint =
      initial[field.key]?.filled && (value === null || value === "") && field.isSensitive ? (
        <p className="mt-1 text-xs text-emerald-700">✓ Reeds ingevuld — laat leeg om te behouden.</p>
      ) : null;

    if (field.type === "heading") {
      return (
        <div>
          <h3 className="font-serif text-base text-ink-900">{field.label}</h3>
          {help}
        </div>
      );
    }

    if (field.type === "file") {
      return (
        <div>
          {label}
          {help}
          <div className="mt-1.5">
            <FileUploader
              requestUpload={(a) => requestOnboardingUpload(field.id, a)}
              currentFilename={files[field.key]?.filename ?? null}
              disabled={readOnly || !r2Configured}
              onUploaded={(documentId, filename) =>
                setFiles((s) => ({ ...s, [field.key]: { documentId, filename } }))
              }
            />
          </div>
          {errEl}
        </div>
      );
    }

    if (field.type === "boolean") {
      return (
        <div>
          {label}
          {help}
          <div className="mt-1.5 flex gap-2">
            {[
              { v: true, l: "Ja" },
              { v: false, l: "Nee" },
            ].map((opt) => (
              <button
                key={opt.l}
                type="button"
                disabled={readOnly}
                onClick={() => setValue(field.key, opt.v)}
                className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] ${
                  value === opt.v
                    ? "bg-burgundy text-white"
                    : "border border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
                } disabled:opacity-50`}
              >
                {opt.l}
              </button>
            ))}
          </div>
          {errEl}
        </div>
      );
    }

    if (field.type === "checkbox") {
      return (
        <div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={value === true}
              disabled={readOnly}
              onChange={(e) => setValue(field.key, e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-burgundy focus:ring-burgundy"
            />
            <span className="font-ui text-[13px] text-ink-800">
              {field.label}
              {field.required ? <span className="text-burgundy"> *</span> : null}
            </span>
          </label>
          {help}
          {errEl}
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div>
          {label}
          {help}
          <select
            value={typeof value === "string" ? value : ""}
            disabled={readOnly}
            onChange={(e) => setValue(field.key, e.target.value || null)}
            className={`mt-1.5 ${INPUT} disabled:opacity-50`}
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

    if (field.type === "multiselect") {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div>
          {label}
          {help}
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(field.options ?? []).map((o) => {
              const on = arr.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    setValue(field.key, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])
                  }
                  className={`rounded-full px-3 py-1.5 font-ui text-[11px] font-medium ${
                    on ? "bg-burgundy text-white" : "border border-ink-200 bg-white text-ink-700"
                  } disabled:opacity-50`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
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
            disabled={readOnly}
            onChange={(e) => setValue(field.key, e.target.value)}
            className={`mt-1.5 ${INPUT} disabled:opacity-50`}
          />
          {errEl}
        </div>
      );
    }

    // text | email | phone | number | date | iban | bsn | postcode | country
    const inputType =
      field.type === "number"
        ? "number"
        : field.type === "date"
          ? "date"
          : field.type === "email"
            ? "email"
            : field.type === "phone"
              ? "tel"
              : "text";
    return (
      <div>
        {label}
        {help}
        <input
          type={inputType}
          inputMode={field.type === "bsn" ? "numeric" : undefined}
          value={value === null || value === undefined ? "" : String(value)}
          placeholder={field.placeholder ?? ""}
          disabled={readOnly}
          onChange={(e) =>
            setValue(field.key, field.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)
          }
          className={`mt-1.5 ${INPUT} disabled:opacity-50`}
        />
        {filledHint}
        {errEl}
      </div>
    );
  }
}
