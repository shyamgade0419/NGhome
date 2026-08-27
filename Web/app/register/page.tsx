'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2, User, MapPin, ChevronRight, ChevronLeft, Eye, EyeOff, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';
import { useAuth } from '@/lib/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// ─── Validation schemas ────────────────────────────────────────────────────────

const societySchema = z.object({
  name: z.string().min(3, 'Society name must be at least 3 characters').max(200),
  registrationNumber: z.string().max(100).optional().or(z.literal('')),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pinCode: z.string().min(4, 'Pin code is required').max(10),
  country: z.string().min(1, 'Country is required'),
  contactEmail: z.string().email('Enter a valid email'),
  contactPhone: z.string().min(7, 'Enter a valid phone number'),
});

const adminSchema = z
  .object({
    firstName: z.string().min(2, 'First name must be at least 2 characters').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
    email: z.string().email('Enter a valid email'),
    phone: z.string().min(7, 'Enter a valid phone number'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Must include an uppercase letter')
      .regex(/[0-9]/, 'Must include a number')
      .regex(/[^A-Za-z0-9]/, 'Must include a special character'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type SocietyData = z.infer<typeof societySchema>;
type AdminData = z.infer<typeof adminSchema>;

// ─── Step indicators ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Society Info', icon: Building2 },
  { id: 2, label: 'Location', icon: MapPin },
  { id: 3, label: 'Admin Account', icon: User },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((step, idx) => {
        const Icon = step.icon;
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                done
                  ? 'bg-primary-600 text-white'
                  : active
                  ? 'bg-primary-600 text-white ring-4 ring-primary-100'
                  : 'bg-slate-100 text-slate-400',
              ].join(' ')}
            >
              {done ? <CheckCircle2 size={16} /> : <Icon size={14} />}
            </div>
            <span
              className={[
                'hidden sm:block text-xs font-medium',
                active ? 'text-primary-700' : done ? 'text-slate-600' : 'text-slate-400',
              ].join(' ')}
            >
              {step.label}
            </span>
            {idx < STEPS.length - 1 && (
              <div
                className={[
                  'mx-1 h-px w-8 sm:w-12 transition-colors',
                  done ? 'bg-primary-400' : 'bg-slate-200',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Society basic info ───────────────────────────────────────────────

function Step1({
  onNext,
  defaultValues,
}: {
  onNext: (d: Pick<SocietyData, 'name' | 'registrationNumber' | 'contactEmail' | 'contactPhone'>) => void;
  defaultValues?: Partial<SocietyData>;
}) {
  const schema = z.object({
    name: societySchema.shape.name,
    registrationNumber: societySchema.shape.registrationNumber,
    contactEmail: societySchema.shape.contactEmail,
    contactPhone: societySchema.shape.contactPhone,
  });
  const { register, handleSubmit, formState: { errors } } = useForm<
    Pick<SocietyData, 'name' | 'registrationNumber' | 'contactEmail' | 'contactPhone'>
  >({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name,
      registrationNumber: defaultValues?.registrationNumber,
      contactEmail: defaultValues?.contactEmail,
      contactPhone: defaultValues?.contactPhone,
    },
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <Input
        label="Society / Apartment Name *"
        placeholder="e.g. Green Valley Apartments"
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="Registration Number"
        placeholder="e.g. MH-2023-12345 (optional)"
        error={errors.registrationNumber?.message}
        {...register('registrationNumber')}
      />
      <Input
        label="Society Contact Email *"
        type="email"
        placeholder="admin@greenvallley.com"
        error={errors.contactEmail?.message}
        {...register('contactEmail')}
      />
      <Input
        label="Society Contact Phone *"
        type="tel"
        placeholder="+91 98765 43210"
        error={errors.contactPhone?.message}
        {...register('contactPhone')}
      />
      <Button type="submit" className="w-full" size="lg">
        Next <ChevronRight size={16} />
      </Button>
    </form>
  );
}

// ─── Step 2: Location ─────────────────────────────────────────────────────────

function Step2({
  onNext,
  onBack,
  defaultValues,
}: {
  onNext: (d: Pick<SocietyData, 'address' | 'city' | 'state' | 'pinCode' | 'country'>) => void;
  onBack: () => void;
  defaultValues?: Partial<SocietyData>;
}) {
  const schema = z.object({
    address: societySchema.shape.address,
    city: societySchema.shape.city,
    state: societySchema.shape.state,
    pinCode: societySchema.shape.pinCode,
    country: societySchema.shape.country,
  });
  const { register, handleSubmit, formState: { errors } } = useForm<
    Pick<SocietyData, 'address' | 'city' | 'state' | 'pinCode' | 'country'>
  >({
    resolver: zodResolver(schema),
    defaultValues: {
      country: defaultValues?.country ?? 'India',
      address: defaultValues?.address,
      city: defaultValues?.city,
      state: defaultValues?.state,
      pinCode: defaultValues?.pinCode,
    },
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <Input
        label="Street Address *"
        placeholder="Plot No. 12, Sector 5, Near City Mall"
        error={errors.address?.message}
        {...register('address')}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="City *"
          placeholder="Mumbai"
          error={errors.city?.message}
          {...register('city')}
        />
        <Input
          label="State *"
          placeholder="Maharashtra"
          error={errors.state?.message}
          {...register('state')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Pin Code *"
          placeholder="400001"
          error={errors.pinCode?.message}
          {...register('pinCode')}
        />
        <Input
          label="Country *"
          placeholder="India"
          error={errors.country?.message}
          {...register('country')}
        />
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1" size="lg">
          <ChevronLeft size={16} /> Back
        </Button>
        <Button type="submit" className="flex-1" size="lg">
          Next <ChevronRight size={16} />
        </Button>
      </div>
    </form>
  );
}

// ─── Step 3: Admin account ────────────────────────────────────────────────────

function Step3({
  onSubmit,
  onBack,
  loading,
  defaultValues,
}: {
  onSubmit: (d: AdminData) => void;
  onBack: () => void;
  loading: boolean;
  defaultValues?: Partial<AdminData>;
}) {
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<AdminData>({
    resolver: zodResolver(adminSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="First Name *"
          placeholder="John"
          error={errors.firstName?.message}
          autoComplete="given-name"
          {...register('firstName')}
        />
        <Input
          label="Last Name *"
          placeholder="Doe"
          error={errors.lastName?.message}
          autoComplete="family-name"
          {...register('lastName')}
        />
      </div>
      <Input
        label="Admin Email *"
        type="email"
        placeholder="john@greenvallley.com"
        error={errors.email?.message}
        autoComplete="email"
        {...register('email')}
      />
      <Input
        label="Admin Phone *"
        type="tel"
        placeholder="+91 98765 43210"
        error={errors.phone?.message}
        autoComplete="tel"
        {...register('phone')}
      />
      <div className="relative">
        <Input
          label="Password *"
          type={showPw ? 'text' : 'password'}
          placeholder="Min 8 chars, uppercase, number, symbol"
          error={errors.password?.message}
          autoComplete="new-password"
          {...register('password')}
        />
        <button
          type="button"
          className="absolute right-3 top-8 text-slate-400 hover:text-slate-600"
          onClick={() => setShowPw((v) => !v)}
        >
          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <div className="relative">
        <Input
          label="Confirm Password *"
          type={showConfirm ? 'text' : 'password'}
          placeholder="Re-enter password"
          error={errors.confirmPassword?.message}
          autoComplete="new-password"
          {...register('confirmPassword')}
        />
        <button
          type="button"
          className="absolute right-3 top-8 text-slate-400 hover:text-slate-600"
          onClick={() => setShowConfirm((v) => !v)}
        >
          {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1" size="lg" disabled={loading}>
          <ChevronLeft size={16} /> Back
        </Button>
        <Button type="submit" loading={loading} className="flex-1" size="lg">
          Register Society
        </Button>
      </div>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Accumulated form data across steps
  const [societyData, setSocietyData] = useState<Partial<SocietyData>>({});
  const [adminData, setAdminData] = useState<Partial<AdminData>>({});

  const handleStep1 = (d: Pick<SocietyData, 'name' | 'registrationNumber' | 'contactEmail' | 'contactPhone'>) => {
    setSocietyData((prev) => ({ ...prev, ...d }));
    setStep(2);
  };

  const handleStep2 = (d: Pick<SocietyData, 'address' | 'city' | 'state' | 'pinCode' | 'country'>) => {
    setSocietyData((prev) => ({ ...prev, ...d }));
    setStep(3);
  };

  const handleStep3 = async (admin: AdminData) => {
    setAdminData(admin);
    setLoading(true);

    const payload = {
      society: {
        name: societyData.name,
        registrationNumber: societyData.registrationNumber || undefined,
        address: societyData.address,
        city: societyData.city,
        state: societyData.state,
        pinCode: societyData.pinCode,
        country: societyData.country,
        contactEmail: societyData.contactEmail,
        contactPhone: societyData.contactPhone,
      },
      admin: {
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        phone: admin.phone,
        password: admin.password,
      },
    };

    try {
      const res = await axios.post('/api/auth/register-society', payload);
      setSession(res.data.user, res.data.memberships);
      toast.success('Society registered! Welcome to NG Home 🎉');
      router.replace('/');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        (Array.isArray(err?.response?.data?.message)
          ? err.response.data.message.join(', ')
          : 'Registration failed. Please try again.');
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-5/12 flex-col items-center justify-center bg-primary-600 px-12 text-white">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold">NG Home</h1>
          <p className="mt-2 text-sm text-primary-200">Powered by NovaGade</p>
          <p className="mt-8 text-base text-primary-100 leading-relaxed">
            Register your apartment society and get a complete management platform — billing, payments, expenses, and resident communication in one place.
          </p>

          <div className="mt-12 space-y-4 text-left">
            {[
              { emoji: '⚡', title: 'Up in 3 minutes', desc: 'Fill this form and your portal is ready' },
              { emoji: '🏢', title: 'Multi-building support', desc: 'Manage towers, wings, and blocks' },
              { emoji: '💳', title: 'Billing engine', desc: '8 calculation methods for any maintenance model' },
              { emoji: '📊', title: 'Real-time financials', desc: 'Live dashboards, audit trails, reports' },
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
              <p className="text-xs text-slate-500">Powered by NovaGade</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Register your society</h2>
          <p className="mt-1 text-sm text-slate-500">
            Step {step} of {STEPS.length} — {STEPS[step - 1].label}
          </p>

          <div className="mt-6">
            <StepIndicator current={step} />
          </div>

          {step === 1 && (
            <Step1 onNext={handleStep1} defaultValues={societyData as Partial<SocietyData>} />
          )}
          {step === 2 && (
            <Step2
              onNext={handleStep2}
              onBack={() => setStep(1)}
              defaultValues={societyData as Partial<SocietyData>}
            />
          )}
          {step === 3 && (
            <Step3
              onSubmit={handleStep3}
              onBack={() => setStep(2)}
              loading={loading}
              defaultValues={adminData as Partial<AdminData>}
            />
          )}

          <p className="mt-8 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-primary-600 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
