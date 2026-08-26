import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-50">
      <p className="text-7xl font-bold text-slate-200">404</p>
      <h1 className="text-xl font-semibold text-slate-700">Page not found</h1>
      <Link href="/" className="text-sm text-primary-600 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
