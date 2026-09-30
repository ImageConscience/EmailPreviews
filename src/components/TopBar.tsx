"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/actions/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Sentinel option value: not a company, a trip to the company list. */
const NEW_COMPANY = "__new__";

interface Props {
  companyId: string;
  companyName: string;
  userName: string;
  role: string;
  /** Admin or above on a company that has a Klaviyo key stored. */
  canPush: boolean;
  otherCompanies: { id: string; name: string }[];
}

export function TopBar({ companyId, companyName, userName, role, canPush, otherCompanies }: Props) {
  const pathname = usePathname();
  const base = `/c/${companyId}`;

  /**
   * Two things you do daily, and everything you set up once.
   *
   * Templates, sheets, images and people are all "how this company is
   * configured" -- worth a tab each while you are setting up, and noise across
   * the top of every screen afterwards. They live behind Settings; Overview and
   * Preview stay where your hands are.
   */
  const links = [
    { href: `${base}/overview`, label: "Overview" },
    { href: `${base}/preview`, label: "Preview" },
    // Third only for the people who can push, and only once there is somewhere
    // to push to.
    ...(canPush ? [{ href: `${base}/push`, label: "Push" }] : []),
  ];
  // Settings is how this *company* is configured. Anything about the person
  // looking at it lives under their own name instead, on the right.
  const settings = [
    { href: `${base}/templates`, label: "Templates" },
    { href: `${base}/sheets`, label: "Content" },
    { href: `${base}/media`, label: "Images" },
    { href: `${base}/integrations`, label: "Integrations" },
    { href: `${base}/members`, label: "Team" },
  ];

  const mine = [
    { href: `${base}/profile`, label: "Profile" },
    { href: `${base}/connector`, label: "Claude connector" },
  ];

  // Which menu is open, rather than whether one is: opening either should
  // close the other, and two booleans drift into both being true.
  const [open, setOpen] = useState<"settings" | "mine" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mineRef = useRef<HTMLDivElement>(null);
  const settingsActive = settings.some((link) => pathname.startsWith(link.href));
  const mineActive = mine.some((link) => pathname.startsWith(link.href));

  // The menu closes on anything that means "I am done here": a click elsewhere,
  // Escape, or arriving on a new page.
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const inside =
        menuRef.current?.contains(event.target as Node) ||
        mineRef.current?.contains(event.target as Node);
      if (!inside) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

        <div className="menu" ref={menuRef}>
          <button
            type="button"
            className={`menu-trigger${settingsActive ? " active" : ""}`}
            aria-expanded={open === "settings"}
            aria-haspopup="true"
            onClick={() => setOpen((previous) => (previous === "settings" ? null : "settings"))}
          >
            Settings <span aria-hidden="true">▾</span>
          </button>
          {open === "settings" && (
            <div className="menu-list" role="menu">
              {settings.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  className={pathname.startsWith(link.href) ? "active" : ""}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>
      <div className="spacer" />
      <div className="row" style={{ gap: 8 }}>
        <ThemeToggle />
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
        {/*
          Your own name is where you look for your own things. Signing out
          lives here too rather than beside it: it is the last item of a menu
          about you, not a button competing with the company switcher.
        */}
        <div className="menu" ref={mineRef}>
          <button
            type="button"
            className={`menu-trigger${mineActive ? " active" : ""}`}
            aria-expanded={open === "mine"}
            aria-haspopup="true"
            title={role}
            onClick={() => setOpen((previous) => (previous === "mine" ? null : "mine"))}
          >
            {userName} <span aria-hidden="true">▾</span>
          </button>
          {open === "mine" && (
            <div className="menu-list menu-right" role="menu">
              {mine.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  className={pathname.startsWith(link.href) ? "active" : ""}
                >
                  {link.label}
                </Link>
              ))}
              <div className="menu-rule" />
              <form action={logoutAction}>
                <button type="submit" className="menu-signout" role="menuitem">
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
