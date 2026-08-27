/**
 * Shown in place of the app when it starts without a usable database.
 *
 * This exists so a misconfigured deploy explains itself at its own URL, rather
 * than serving nothing and leaving the reason in the platform's logs.
 */
export function SetupNeeded({
  summary,
  detail,
  steps,
}: {
  summary: string;
  detail: string;
  steps: string[];
}) {
  return (
    <main className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <span className="brand">Email Previews</span>
        <p className="tagline">Almost there — one setup step is missing.</p>

        <div className="card card-pad">
          <div className="alert alert-warn" style={{ marginBottom: 14 }}>
            <strong>{summary}</strong>
          </div>

          <p style={{ color: "var(--text-muted)" }}>{detail}</p>

          {steps.length > 0 && (
            <>
              <h3 style={{ margin: "18px 0 8px" }}>To fix it</h3>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}

          <p className="hint" style={{ marginTop: 18, marginBottom: 0 }}>
            The app checks again every time it starts. Changing a variable
            redeploys automatically, so this page is replaced by the sign-in
            screen once the database is connected — nothing here needs
            revisiting.
          </p>
        </div>

        <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>
          Your templates and content are unaffected; the app has simply not been
          able to reach its database yet.
        </p>
      </div>
    </main>
  );
}
