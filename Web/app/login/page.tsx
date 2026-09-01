'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const schema = z.object({
  identifier: z.string().min(1, 'Email or phone is required'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const result = await login(data.identifier, data.password);
      if (result?.requiresSocietySelection) {
        router.replace('/select-society');
      } else {
        const from = searchParams.get('from') ?? '/';
        router.replace(from);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Invalid credentials';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-primary-600 px-12 text-white">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold">NG Home</h1>
          <p className="mt-2 text-sm text-primary-200">Powered by NovaGade</p>
          <p className="mt-8 text-base text-primary-100 leading-relaxed">
            Complete apartment &amp; community management — billing, payments, expenses, and more in one place.
          </p>

          <div className="mt-12 grid grid-cols-2 gap-4 text-left">
            {[
              { n: 'Multi-tenant', d: 'One platform, many societies' },
              { n: 'Billing Engine', d: '8 calculation methods' },
              { n: 'Payment Approvals', d: 'Atomic financial workflow' },
              { n: 'Reports & Insights', d: 'Real-time financials' },
            ].map((f) => (
              <div key={f.n} className="rounded-xl bg-white/10 p-4">
                <p className="text-sm font-semibold">{f.n}</p>
                <p className="mt-0.5 text-xs text-primary-200">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600">
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-900">NG Home</p>
              <p className="text-xs text-slate-500">Powered by NovaGade</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to your NG Home account</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
            <Input
              label="Email or Phone"
              type="text"
              placeholder="admin@society.com"
              error={errors.identifier?.message}
              autoComplete="username"
              {...register('identifier')}
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                error={errors.password?.message}
                autoComplete="current-password"
                {...register('password')}
              />
              <button
                type="button"
                className="absolute right-3 top-8 text-slate-400 hover:text-slate-600"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign in
            </Button>

            <div className="text-center">
              <Link href="/forgot-password" className="text-sm text-primary-600 hover:underline">
                Forgot password?
              </Link>
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            New resident?{' '}
            <Link href="/join" className="text-primary-600 font-medium hover:underline">
              Join with invite code
            </Link>
          </p>

          <p className="mt-2 text-center text-sm text-slate-500">
            Setting up a new society?{' '}
            <Link href="/register" className="text-primary-600 font-medium hover:underline">
              Register your society
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
