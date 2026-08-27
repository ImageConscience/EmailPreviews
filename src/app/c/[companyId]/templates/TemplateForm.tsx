"use client";

import { useActionState, useMemo, useState } from "react";
import { extractPlaceholders } from "@/lib/template";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "@/actions/content";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

const initial: FormState = {};

export function TemplateForm({
  action,
  defaults,
  submitLabel,
}: {
  action: Action;
  defaults?: { name: string; description: string; html: string };
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, initial);
  const [html, setHtml] = useState(defaults?.html ?? "");

  // Live placeholder detection: the author sees immediately which tokens the
  // app found, which is how typos like {{ headline}} get caught before saving.
  const placeholders = useMemo(() => extractPlaceholders(html), [html]);

  return (
    <form action={dispatch}>
      {state.error && <div className="alert alert-error">{state.error}</div>}
      {state.ok && <div className="alert alert-ok">{state.ok}</div>}

      <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
        <label className="field" style={{ flex: "1 1 240px" }}>
          <span>Name</span>
          <input type="text" name="name" required defaultValue={defaults?.name} placeholder="Weekly promo" />
        </label>
        <label className="field" style={{ flex: "2 1 320px" }}>
          <span>Description (optional)</span>
          <input
            type="text"
            name="description"
            defaultValue={defaults?.description}
            placeholder="Two-column layout with hero image"
          />
        </label>
      </div>

      <label className="field">
        <span>HTML</span>
        <textarea
          name="html"
          className="code"
          required
          rows={22}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder={'<table><tr><td><img src="{{ hero_image }}"><h1>{{ headline }}</h1></td></tr></table>'}
          spellCheck={false}
        />
        <span className="hint">
          Use <code>{"{{ name }}"}</code> for values that should be escaped, and{" "}
          <code>{"{{{ name }}}"}</code> when the cell contains markup you want rendered as-is.
        </span>
      </label>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <h3 style={{ marginBottom: 8 }}>
          Placeholders found{" "}
          <span className="badge badge-accent">{placeholders.length}</span>
        </h3>
        {placeholders.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            None yet — nothing in this HTML matches <code>{"{{ ... }}"}</code>.
          </p>
        ) : (
          <div className="chiplist">
            {placeholders.map((p) => (
              <span key={p} className="chip">
                {p}
              </span>
            ))}
          </div>
        )}
      </div>

      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
