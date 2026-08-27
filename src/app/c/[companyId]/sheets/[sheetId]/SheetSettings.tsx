"use client";

import { useActionState } from "react";
import { addColumnAction, renameSheetAction, type FormState } from "@/actions/content";
import { SubmitButton } from "@/components/SubmitButton";

const initial: FormState = {};

export function SheetSettings({
  companyId,
  sheetId,
  name,
  columns,
}: {
  companyId: string;
  sheetId: string;
  name: string;
  columns: string[];
}) {
  const [renameState, rename] = useActionState(
    renameSheetAction.bind(null, companyId, sheetId),
    initial,
  );
  const [columnState, addColumn] = useActionState(
    addColumnAction.bind(null, companyId, sheetId),
    initial,
  );

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <h2 style={{ marginBottom: 12 }}>Sheet settings</h2>

      <form action={rename} style={{ marginBottom: 20 }}>
        {renameState.error && <div className="alert alert-error">{renameState.error}</div>}
        {renameState.ok && <div className="alert alert-ok">{renameState.ok}</div>}
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Name</span>
          <input type="text" name="name" defaultValue={name} required />
        </label>
        <SubmitButton className="btn btn-sm" pendingLabel="Saving…">
          Rename
        </SubmitButton>
      </form>

      <form action={addColumn}>
        {columnState.error && <div className="alert alert-error">{columnState.error}</div>}
        {columnState.ok && <div className="alert alert-ok">{columnState.ok}</div>}
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Add a column</span>
          <input type="text" name="column" placeholder="preheader_text" />
          <span className="hint">
            Useful when a template needs a placeholder the original spreadsheet did not have.
            Existing rows start blank.
          </span>
        </label>
        <SubmitButton className="btn btn-sm" pendingLabel="Adding…">
          Add column
        </SubmitButton>
      </form>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 6 }}>Columns</h3>
        <div className="chiplist">
          {columns.map((column) => (
            <span key={column} className="chip">
              {column}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
