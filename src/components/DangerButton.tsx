"use client";

import { useFormStatus } from "react-dom";

/** Submit button that makes the user confirm before a destructive action runs. */
export function DangerButton({
  children,
  confirm,
  className = "btn btn-danger btn-sm",
}: {
  children: React.ReactNode;
  confirm: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
