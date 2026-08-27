"use client";

import { useActionState, useState } from "react";
import { uploadSheetAction, type FormState } from "@/actions/content";
import { SubmitButton } from "@/components/SubmitButton";

const initial: FormState = {};

export function UploadSheetForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState(uploadSheetAction.bind(null, companyId), initial);
  const [filename, setFilename] = useState("");

  const isWorkbook = /\.(xlsx|xlsm|xls)$/i.test(filename);

  return (
    <form action={action}>
      {state.error && <div className="alert alert-error">{state.error}</div>}

      <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
        <label className="field" style={{ flex: "1 1 260px" }}>
          <span>File</span>
          <input
            type="file"
            name="file"
            accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
            required
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? "")}
          />
          <span className="hint">.csv, .tsv or .xlsx — first row is treated as the header.</span>
        </label>
        <label className="field" style={{ flex: "1 1 200px" }}>
          <span>Name (optional)</span>
          <input type="text" name="name" placeholder="Defaults to the filename" />
        </label>
        {isWorkbook && (
          <label className="field" style={{ flex: "1 1 180px" }}>
            <span>Worksheet (optional)</span>
            <input type="text" name="worksheet" placeholder="First sheet" />
            <span className="hint">Name the tab to import, if not the first one.</span>
          </label>
        )}
      </div>

      <SubmitButton pendingLabel="Importing…">Upload and import</SubmitButton>
    </form>
  );
}
