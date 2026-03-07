/** Simple 404 fallback page. */
export default function NotFoundPage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-brand-500 mb-4">404</h1>
        <p className="text-slate-400">Page not found.</p>
        <a href="/" className="mt-6 inline-block underline text-brand-500">
          Go home
        </a>
      </div>
    </main>
  );
}
