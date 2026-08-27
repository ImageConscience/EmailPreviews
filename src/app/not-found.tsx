import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-wrap">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <span className="brand">Not found</span>
        <p className="tagline">
          That page does not exist, or you do not have access to it.
        </p>
        <Link href="/" className="btn btn-primary">
          Go home
        </Link>
      </div>
    </main>
  );
}
