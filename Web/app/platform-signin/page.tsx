'use client';

/**
 * Sign-in for the platform console. Signed-out requests to any /platform URL
 * are rewritten here (see middleware.ts), so the address bar keeps the page
 * that was asked for and, once signed in, a reload lands on it.
 *
 * Deliberately not the society login: no invite-code or register links, and
 * an account that isn't a platform admin is turned away here rather than
 * dropped into the society app.
 */

import { useState } from 'react';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { authApi } from '@/lib/api/auth';

export default function PlatformSignInPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await login(identifier.trim(), password);
      if (result?.isPlatformAdmin) {
        // Full reload on the same URL: the request now carries the session,
        // so the console is served instead of this form.
        window.location.replace(window.location.pathname);
        return;
      }
      // A valid account, but not a platform admin: don't leave a society
      // session behind from the console's front door.
      await authApi.logout().catch(() => {});
      setError('This account is not a platform administrator. Society admins and residents sign in at the main login.');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const input =
    'w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 ' +
    'focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500 text-gray-950">
            <ShieldCheck size={22} />
          </span>
          <div>
            <p className="text-base font-bold text-white">NG Home Platform</p>
            <p className="text-xs text-gray-400">NovaGade administration</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-6">
          <h1 className="text-xl font-bold text-white">Platform admin sign in</h1>
          <p className="mt-1 text-sm text-gray-400">For NovaGade platform administrators only.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="pa-identifier" className="mb-1 block text-sm font-medium text-gray-300">
                Email
              </label>
              <input
                id="pa-identifier"
                type="text"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@novagade.in"
                className={input}
              />
            </div>

            <div>
              <label htmlFor="pa-password" className="mb-1 block text-sm font-medium text-gray-300">
                Password
              </label>
              <div className="relative">
                <input
                  id="pa-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${input} pr-10`}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-teal-400 disabled:opacity-60"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              Sign in
            </button>

            <div className="text-center">
              <a href="/forgot-password" className="text-sm text-teal-400 hover:underline">
                Forgot password?
              </a>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          Looking for your society?{' '}
          <a href="/login" className="text-gray-300 hover:underline">
            Go to the main login
          </a>
        </p>
      </div>
    </div>
  );
}
