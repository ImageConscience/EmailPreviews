"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/actions/auth";

/** Sentinel option value: not a company, a trip to the company list. */
const NEW_COMPANY = "__new__";

interface Props {
  companyId: string;
  companyName: string;
  userName: string;
  role: string;
  otherCompanies: { id: string; name: string }[];
}

export function TopBar({ companyId, companyName, userName, role, otherCompanies }: Props) {
  const pathname = usePathname();
  const base = `/c/${companyId}`;
  const links = [
    { href: `${base}/overview`, label: "Overview" },
    { href: `${base}/preview`, label: "Preview" },
    { href: `${base}/templates`, label: "Templates" },
    { href: `${base}/sheets`, label: "Content" },
    { href: `${base}/media`, label: "Images" },
    { href: `${base}/members`, label: "Team" },
  ];

  return (
    <header className="topbar">
      <Link href={base} className="brand">
        Email Previews
      </Link>
      <nav>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname.startsWith(link.href) ? "active" : ""}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      <div className="row" style={{ gap: 8 }}>
        {/*
          Always a select, even with one company: this is where someone looks
          for their other companies, so it is also where "add another" belongs.
          A static label here left new companies with nowhere to be created from.
        */}
        <select
          value={companyId}
          onChange={(e) => {
            const next = e.target.value;
            window.location.href = next === NEW_COMPANY ? "/companies" : `/c/${next}`;
          }}
          style={{ width: "auto", maxWidth: 220 }}
          aria-label="Switch company"
        >
          <option value={companyId}>{companyName}</option>
          {otherCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option disabled>──────────</option>
          <option value={NEW_COMPANY}>+ New company…</option>
        </select>
        <span className="hint" title={role} style={{ marginTop: 0 }}>
          {userName}
        </span>
        <form action={logoutAction}>
          <button type="submit" className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
