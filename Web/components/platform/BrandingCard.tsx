'use client';

/**
 * A society's branding, set by the platform team: the app name, logo and one
 * brand colour its residents and admins see in the dashboard and the mobile
 * app. A society's own admins cannot change it.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Palette, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { platformApi } from '@/lib/api/endpoints';
import { Card, DButton } from '@/components/platform/ui';
import { MAX_LOGO_BYTES, MIN_CONTRAST_WITH_WHITE, contrastWithWhite, isHexColor } from '@/lib/branding';

const DEFAULT_COLOR = '#0D2147';
const LOGO_BOX = 256;

/** Shrinks any image to fit a 256px box and returns it as a PNG data URI, so a phone photo or a 4000px logo is fine to upload. */
function toLogoDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, LOGO_BOX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

export function BrandingCard({ societyId, societyName }: { societyId: string; societyName: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-branding', societyId],
    queryFn: () => platformApi.getBranding(societyId).then((r) => r.data),
  });

  const [appName, setAppName] = useState('');
  const [color, setColor] = useState('');
  const [logo, setLogo] = useState<string | null>(null);

  // Load what is saved into the form once it arrives (and again after a save).
  useEffect(() => {
    if (!data) return;
    setAppName(data.appName ?? '');
    setColor(data.primaryColor ?? '');
    setLogo(data.logoDataUri);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      platformApi.setBranding(societyId, {
        appName: appName.trim() || null,
        primaryColor: color.trim() || null,
        logoDataUri: logo,
      }),
    onSuccess: () => {
      toast.success('Branding saved. People see it the next time they open the app.');
      qc.invalidateQueries({ queryKey: ['platform-branding', societyId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the branding'),
  });

  const colorOk = color === '' || isHexColor(color);
  const ratio = isHexColor(color) ? contrastWithWhite(color) : null;
  const tooLight = ratio !== null && ratio < MIN_CONTRAST_WITH_WHITE;

  const dirty =
    !!data && ((data.appName ?? '') !== appName.trim() || (data.primaryColor ?? '').toUpperCase() !== color.trim().toUpperCase() || data.logoDataUri !== logo);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error('Please choose a PNG, JPEG or WebP image.');
      return;
    }
    try {
      const uri = await toLogoDataUri(file);
      // base64 is ~4/3 the size of the bytes it carries.
      if (Math.floor((uri.length * 3) / 4) > MAX_LOGO_BYTES) {
        toast.error('That logo is still too large after resizing. Try a simpler image.');
        return;
      }
      setLogo(uri);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not read that image');
    }
  };

  const shown = isHexColor(color) ? color : DEFAULT_COLOR;
  const input =
    'w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

  return (
    <Card title="Branding" icon={Palette}>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              The name, logo and colour this society&rsquo;s people see in the dashboard and the mobile app. Its own admins cannot
              change them. The Google Play listing, launcher icon and splash screen stay NG Home.
            </p>

            <div>
              <label htmlFor="brand-name" className="mb-1 block text-xs font-medium text-gray-300">App name</label>
              <input
                id="brand-name"
                value={appName}
                maxLength={40}
                onChange={(e) => setAppName(e.target.value)}
                placeholder={societyName}
                className={input}
              />
              <p className="mt-1 text-xs text-gray-500">Shown instead of &ldquo;NG Home&rdquo;. Leave blank to keep NG Home.</p>
            </div>

            <div>
              <label htmlFor="brand-color" className="mb-1 block text-xs font-medium text-gray-300">Brand colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick a colour"
                  value={shown}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  className="h-9 w-12 cursor-pointer rounded border border-gray-700 bg-gray-950 p-0.5"
                />
                <input
                  id="brand-color"
                  value={color}
                  onChange={(e) => setColor(e.target.value.trim())}
                  placeholder="#0D2147"
                  maxLength={7}
                  className={`${input} max-w-[9rem] font-mono`}
                />
                {color && (
                  <button type="button" onClick={() => setColor('')} className="text-xs text-gray-400 hover:text-white">
                    Use NG Home navy
                  </button>
                )}
              </div>
              {!colorOk && <p className="mt-1 text-xs text-red-400">Use a colour like #1A5FB4.</p>}
              {colorOk && tooLight && (
                <p className="mt-1 text-xs text-red-400">
                  Too light: white text on it would be hard to read ({ratio!.toFixed(1)}:1, needs {MIN_CONTRAST_WITH_WHITE}:1). Pick a darker shade.
                </p>
              )}
              {colorOk && ratio !== null && !tooLight && (
                <p className="mt-1 text-xs text-gray-500">Contrast with white text: {ratio.toFixed(1)}:1. Good.</p>
              )}
            </div>

            <div>
              <span className="mb-1 block text-xs font-medium text-gray-300">Logo</span>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-gray-700 bg-white">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small data URI preview
                    <img src={logo} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImagePlus size={20} className="text-gray-400" />
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <DButton size="sm" onClick={() => fileRef.current?.click()}>
                  {logo ? 'Change logo' : 'Upload logo'}
                </DButton>
                {logo && (
                  <DButton size="sm" onClick={() => setLogo(null)}>
                    <Trash2 size={13} /> Remove
                  </DButton>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">PNG, JPEG or WebP. A square image on a transparent or white background looks best. It is resized for you.</p>
            </div>

            <div className="flex gap-2 pt-1">
              <DButton variant="primary" loading={save.isPending} disabled={!dirty || !colorOk || tooLight} onClick={() => save.mutate()}>
                Save branding
              </DButton>
              {dirty && (
                <DButton
                  onClick={() => {
                    setAppName(data?.appName ?? '');
                    setColor(data?.primaryColor ?? '');
                    setLogo(data?.logoDataUri ?? null);
                  }}
                >
                  Discard changes
                </DButton>
              )}
            </div>
          </div>

          {/* What a resident sees */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Preview</p>
            <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#FAF6EE]">
              <div className="flex items-center gap-2.5 border-b border-[#E8DFCD] bg-white px-4 py-3">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small data URI preview
                  <img src={logo} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-contain" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: shown }}>
                    <Palette size={15} />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold leading-none text-[#2B2620]">{appName.trim() || 'NG Home'}</p>
                  <p className="mt-0.5 text-[10px] leading-none text-[#9C8D75]">
                    {appName.trim() ? 'Powered by NovaGade' : 'by NovaGade'}
                  </p>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: shown, color: '#fff' }}>
                  Pay maintenance
                </div>
                <div className="rounded-lg bg-[#F4EEE2] px-3 py-2 text-xs font-medium" style={{ color: shown }}>
                  Active menu item
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
