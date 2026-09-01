'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, Eye, EyeOff, Home } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

interface SocietyInfo {
  id: string;
  name: string;
  flats: { id: string; flatCode: string; unitNumber: string; building?: { name: string } }[];
}

export default function JoinPage() {
  const router = useRouter();
  const [step, setStep] = useState<'code' | 'details'>('code');
  const [loading, setLoading] = useState(false);

  // Step 1: invite code
  const [code, setCode] = useState('');
  const [society, setSociety] = useState<SocietyInfo | null>(null);

  // Step 2: personal details
  const [flatId, setFlatId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const lookupCode = async () => {
    if (!code.trim()) { toast.error('Enter your invite code'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/societies/by-code?code=${encodeURIComponent(code.trim().toUpperCase())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? 'Invalid invite code');
      setSociety(data);
      setFlatId(data.flats?.[0]?.id ?? '');
      setStep('details');
    } catch (err: any) {
      toast.error(err.message ?? 'Could not find society');
    } finally {
      setLoading(false);
    }
  };

  const submitJoin = async () => {
    if (!flatId) { toast.error('Select your flat'); return; }
    if (!firstName.trim() || !lastName.trim()) { toast.error('Enter your name'); return; }
    if (!email.includes('@')) { toast.error('Enter a valid email'); return; }
    if (!phone.match(/^\+?\d{7,15}$/)) { toast.error('Enter a valid phone number'); return; }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/join-society', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: code.trim().toUpperCase(),
          flatId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(
        Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? 'Registration failed')
      );
      toast.success('Welcome to ' + society?.name + '! Please sign in.');
      router.replace('/login');
    } catch (err: any) {
      toast.error(err.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const flatOptions = (society?.flats ?? []).map((f) => ({
    value: f.id,
    label: `${f.flatCode}${f.building ? ' · ' + f.building.name : ''}`,
  }));

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Left branding */}
      <div className="hidden lg:flex lg:w-5/12 flex-col items-center justify-center bg-primary-600 px-12 text-white">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Home size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold">NG Home</h1>
          <p className="mt-2 text-sm text-primary-200">Resident Portal</p>
          <p className="mt-8 text-base text-primary-100 leading-relaxed">
            Join your apartment society to view your maintenance bills, raise helpdesk requests, and stay connected with community announcements.
          </p>
          <div className="mt-10 space-y-4 text-left">
            {[
              { emoji: '🔑', title: 'Use your invite code', desc: 'Get it from your society admin or notice board' },
              { emoji: '🏠', title: 'Pick your flat', desc: 'Select your unit from the registered list' },
              { emoji: '📱', title: 'Instant access', desc: 'Bills, payments, helpdesk — all in one place' },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3 rounded-xl bg-white/10 p-4">
                <span className="text-xl">{f.emoji}</span>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="mt-0.5 text-xs text-primary-200">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="mb-6 lg:hidden flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600">
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-900">NG Home</p>
              <p className="text-xs text-slate-500">Resident Portal</p>
            </div>
          </div>

          {step === 'code' ? (
            <>
              <h2 className="text-2xl font-bold text-slate-900">Join your society</h2>
              <p className="mt-1 text-sm text-slate-500">
                Enter the invite code shared by your society admin to create your resident account.
              </p>
              <div className="mt-8 space-y-5">
                <Input
                  label="Invite Code *"
                  placeholder="e.g. CQV6-P9ZD"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && lookupCode()}
                  className="uppercase font-mono tracking-widest"
                />
                <Button onClick={lookupCode} loading={loading} className="w-full" size="lg">
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100">
                  <Building2 size={18} className="text-primary-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{society?.name}</p>
                  <button
                    onClick={() => setStep('code')}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    Change code
                  </button>
                </div>
              </div>

              <h2 className="text-2xl font-bold text-slate-900">Create your account</h2>
              <p className="mt-1 text-sm text-slate-500">Fill in your details to complete registration.</p>

              <div className="mt-6 space-y-4">
                {flatOptions.length > 0 && (
                  <Select
                    label="Your Flat *"
                    value={flatId}
                    onChange={(e) => setFlatId(e.target.value)}
                    options={flatOptions}
                  />
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Input label="First Name *" placeholder="Ravi" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  <Input label="Last Name *" placeholder="Kumar" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
                <Input label="Email *" type="email" placeholder="ravi@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input label="Phone *" type="tel" placeholder="+91 9876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <div className="relative">
                  <Input
                    label="Password *"
                    type={showPw ? 'text' : 'password'}
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button type="button" className="absolute right-3 top-8 text-slate-400 hover:text-slate-600" onClick={() => setShowPw(v => !v)}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    label="Confirm Password *"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    error={confirmPassword.length > 0 && password !== confirmPassword ? 'Passwords do not match' : undefined}
                  />
                  <button type="button" className="absolute right-3 top-8 text-slate-400 hover:text-slate-600" onClick={() => setShowConfirm(v => !v)}>
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Button onClick={submitJoin} loading={loading} className="w-full" size="lg">
                  Join Society
                </Button>
              </div>
            </>
          )}

          <p className="mt-8 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-primary-600 font-medium hover:underline">Sign in</Link>
          </p>
          <p className="mt-2 text-center text-sm text-slate-500">
            Setting up a new society?{' '}
            <Link href="/register" className="text-primary-600 font-medium hover:underline">Register here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
