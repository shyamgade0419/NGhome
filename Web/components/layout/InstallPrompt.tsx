'use client';

/**
 * Offers to install NG Home on the home screen or desktop. Chrome, Edge and Android hand us an
 * install prompt to trigger; iPhone and iPad have no such API, so there we say where the button is.
 * Hidden once installed, and once dismissed it stays away for 30 days.
 */

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { dismissInstall, isInstallDismissed, isIosDevice, isStandalone } from '@/lib/pwa';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [hidden, setHidden] = useState(true); // hidden until we've read storage — no flash
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || isInstallDismissed()) return;
    setIos(isIosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    setHidden(false);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-bar away; ours replaces it
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Nothing to say unless there is something to tap (Chrome/Edge/Android) or something to explain (iOS).
  if (hidden || (!deferred && !ios)) return null;

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setHidden(true);
    } catch {
      // The browser refused to show it; the banner stays so they can try again.
    }
    setDeferred(null);
  };

  const dismiss = () => {
    dismissInstall();
    setHidden(true);
  };

  return (
    <div className="border-b border-primary-200 bg-primary-50 px-4 py-2.5 text-sm text-primary-800" role="region" aria-label="Install NG Home">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Download size={16} className="shrink-0 text-primary-600" />
        {ios ? (
          <p className="min-w-0 flex-1">
            Install NG Home on your {/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone'}: tap{' '}
            <Share size={14} className="mx-0.5 inline align-text-bottom" aria-label="Share" /> in Safari, then <strong>Add to Home Screen</strong>.
          </p>
        ) : (
          <p className="min-w-0 flex-1">Install NG Home as an app for one-tap access, without the browser bar.</p>
        )}
        <div className="flex items-center gap-2">
          {!ios && deferred && (
            <button onClick={install} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700">
              Install
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss for 30 days" className="rounded-lg p-1.5 text-primary-700 hover:bg-primary-100">
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
