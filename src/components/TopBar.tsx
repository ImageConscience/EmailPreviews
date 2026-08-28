"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/actions/auth";

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
        {otherCompanies.length > 0 ? (
          <select
            value={companyId}
            onChange={(e) => {
              window.location.href = `/c/${e.target.value}`;
            }}
            style={{ width: "auto", maxWidth: 200 }}
            aria-label="Switch company"
          >
            <option value={companyId}>{companyName}</option>
            {otherCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="badge">{companyName}</span>
        )}
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
