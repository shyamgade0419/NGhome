'use client';

/**
 * "Is email working?" Password-reset and invite emails are sent in the
 * background and a failure only reaches the server log, so a broken mail setup
 * looks like success to the person asking. This logs in to the mail server and
 * sends a real message to the admin pressing the button, and says exactly where
 * it stops.
 */

import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Mail, XCircle } from 'lucide-react';
import { platformApi, type MailCheckResult } from '@/lib/api/endpoints';
import { Card, DButton } from '@/components/platform/ui';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 flex-shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-xs text-gray-200">{value || '—'}</dd>
    </div>
  );
}

export function EmailCheckCard() {
  const check = useMutation({ mutationFn: () => platformApi.checkMail().then((r) => r.data) });
  const result: MailCheckResult | undefined = check.data;

  return (
    <Card title="Email delivery" icon={Mail}>
      <p className="text-sm text-gray-400">
        Password reset and invite emails are sent in the background, so a broken mail setup still shows &ldquo;sent&rdquo; to the
        person asking. This logs in to your mail server and sends a real test message to <strong className="text-gray-200">you</strong>,
        and shows exactly where it stops.
      </p>

      <div className="mt-4">
        <DButton variant="primary" loading={check.isPending} onClick={() => check.mutate()}>
          Check email and send me a test
        </DButton>
      </div>

      {check.isError && (
        <p className="mt-4 text-sm text-red-300">
          {(check.error as any)?.response?.data?.message ??
            ((check.error as any)?.response
              ? `The server answered with an error (${(check.error as any).response.status}) and no details. Check the API log in Coolify.`
              : 'No answer from the server. If you just redeployed, wait a minute and try again; otherwise check that the API is running in Coolify.')}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          {result.setup.warnings.length > 0 && (
            <ul className="space-y-2">
              {result.setup.warnings.map((w) => (
                <li key={w} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <ol className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              {result.setup.configured ? (
                <CheckCircle2 size={16} className="mt-0.5 text-teal-400" />
              ) : (
                <XCircle size={16} className="mt-0.5 text-red-400" />
              )}
              <span className="text-gray-200">{result.setup.configured ? 'Mail settings are present' : 'No mail settings on the server'}</span>
            </li>
            <li className="flex items-start gap-2">
              {result.connection.ok ? (
                <CheckCircle2 size={16} className="mt-0.5 text-teal-400" />
              ) : (
                <XCircle size={16} className="mt-0.5 text-red-400" />
              )}
              <span className="text-gray-200">
                {result.connection.ok ? 'Logged in to the mail server' : 'Could not log in to the mail server'}
                {!result.connection.ok && <span className="mt-0.5 block break-words font-mono text-xs text-red-300">{result.connection.reason}</span>}
              </span>
            </li>
            {result.test && (
              <li className="flex items-start gap-2">
                {result.test.ok ? (
                  <CheckCircle2 size={16} className="mt-0.5 text-teal-400" />
                ) : (
                  <XCircle size={16} className="mt-0.5 text-red-400" />
                )}
                <span className="text-gray-200">
                  {result.test.ok ? (
                    <>
                      Test message handed to the mail server for <strong>{result.test.to}</strong>. Look in that inbox, and in spam.
                    </>
                  ) : (
                    <>
                      The mail server refused the test message
                      <span className="mt-0.5 block break-words font-mono text-xs text-red-300">{result.test.reason}</span>
                    </>
                  )}
                </span>
              </li>
            )}
          </ol>

          <dl className="space-y-1.5 rounded-lg bg-gray-950/60 p-3">
            <Row
              label="Settings from"
              value={{ console: 'Saved in this console', environment: "The server's environment variables", none: 'Nowhere yet' }[result.setup.source]}
            />
            <Row label="Server" value={result.setup.host ? `${result.setup.host}:${result.setup.port ?? ''}` : ''} />
            <Row label="Login" value={result.setup.user ?? ''} />
            <Row label="Sent as" value={result.setup.from} />
            <Row label="Links to" value={result.setup.appUrl} />
          </dl>
        </div>
      )}
    </Card>
  );
}
