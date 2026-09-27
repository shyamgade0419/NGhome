'use client';

/**
 * The optional "buy me a coffee" note. Shown only when the platform admin has
 * switched it on and given a UPI ID; never blocks anything; once dismissed it
 * stays away for 30 days. Sending money is entirely up to the user — the link
 * carries no amount.
 */

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Check, Coffee, Copy, X } from 'lucide-react';
import { supportApi } from '@/lib/api/endpoints';
import { buildUpiUri, dismissSupport, isSupportDismissed } from '@/lib/support';

export function SupportBanner() {
  const [dismissed, setDismissed] = useState(true); // hidden until we've read storage — no flash
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => setDismissed(isSupportDismissed()), []);

  const { data } = useQuery({
    queryKey: ['support-info'],
    queryFn: () => supportApi.info().then((r) => r.data),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const support = data?.support ?? null;

  const uri = support ? buildUpiUri(support.upiId, support.payeeName) : null;

  useEffect(() => {
    if (!open || !uri) return;
    let cancelled = false;
    QRCode.toDataURL(uri, { margin: 1, width: 192 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [open, uri]);

  if (!support || !uri || dismissed) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(support.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the UPI ID is shown on screen to copy by hand.
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="region" aria-label="Support NG Home">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Coffee size={16} className="shrink-0 text-amber-700" />
        <p className="min-w-0 flex-1">{support.message}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            {open ? 'Hide' : 'Buy me a coffee'}
          </button>
          <button
            onClick={() => {
              dismissSupport();
              setDismissed(true);
            }}
            aria-label="Dismiss for 30 days"
            className="rounded-lg p-1.5 text-amber-700 hover:bg-amber-100"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-5 rounded-lg bg-white/70 p-3">
          {qr && <Image src={qr} alt={`UPI QR code for ${support.upiId}`} width={128} height={128} unoptimized className="rounded bg-white" />}
          <div className="space-y-2">
            <p className="text-xs text-amber-800">Scan with any UPI app, or pay to this UPI ID. Any amount, entirely optional.</p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-white px-2 py-1 font-mono text-xs text-slate-800">{support.upiId}</code>
              <button onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium hover:bg-amber-100">
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a href={uri} className="inline-block text-xs font-medium text-amber-800 underline">
              On a phone? Open in your UPI app
            </a>
            <p className="text-[11px] text-amber-700">Thank you — NG Home stays free either way.</p>
          </div>
        </div>
      )}
    </div>
  );
}
