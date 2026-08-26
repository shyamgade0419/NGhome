'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const schema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});
type FormData = z.infer<typeof schema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="font-semibold text-slate-900">Invalid reset link</p>
          <p className="mt-1 text-sm text-slate-500">
            This link is missing a token. Please request a new one.
          </p>
          <a href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-primary-600 hover:underline">
            Request reset link
          </a>
        </div>
      </div>
    );
  }

  const onSubmit = async ({ newPassword }: FormData) => {
    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      toast.success('Password reset! Please log in.');
      router.replace('/login');
    } catch {
      toast.error('This link has expired or is invalid. Please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600">
            <Building2 size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set new password</h1>
          <p className="text-center text-sm text-slate-500">
            Choose a strong password of at least 8 characters.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="relative">
            <Input
              label="New password"
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />
            <button
              type="button"
              className="absolute right-3 top-9 text-slate-400 hover:text-slate-600"
              onClick={() => setShowNew((v) => !v)}
            >
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="relative">
            <Input
              label="Confirm new password"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
            <button
              type="button"
              className="absolute right-3 top-9 text-slate-400 hover:text-slate-600"
              onClick={() => setShowConfirm((v) => !v)}
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button type="submit" loading={loading} className="w-full">
            Reset password
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
