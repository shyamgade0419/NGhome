/**
 * A URL setting pasted with a trailing slash. Browsers send an Origin with
 * none, so a CORS entry ending in "/" can never match it, and APP_URL is
 * joined with a leading-slash path ("${appUrl}/reset-password"), which
 * would produce "//". Normalised here so a copy-paste slip can't cause either.
 */
export function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** The bare address inside "Name <a@b.com>" or "a@b.com"; null when there is none. */
export function addressOf(value: string | undefined | null): string | null {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(value ?? '') ?? /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(value ?? '');
  return m ? m[1] : null;
}

/**
 * The From address for outgoing mail.
 *
 * Mail servers only accept a sender they own: Gmail, Zoho and most hosted
 * SMTP refuse (553 "sender address rejected") or silently spam-fold mail whose
 * From is a domain the login does not control. The sample .env ships
 * SMTP_FROM=…@nghome.app — a domain nobody here owns — and the code used the
 * same placeholder when SMTP_FROM was unset, so a deployment that copied the
 * sample sent every reset email from an address its server would not relay.
 *
 * So an unset or placeholder SMTP_FROM now falls back to the mailbox the
 * server logs in as, when that login is an email address. An address set on
 * purpose (anything that is not the placeholder) is left exactly as written.
 */
export function resolveMailFrom(from: string | undefined, login: string | undefined): string {
  const placeholder = 'NG Home <no-reply@nghome.app>';
  const configured = (from ?? '').trim();
  const isPlaceholder = !configured || /@nghome\.app>?$/i.test(configured);
  if (!isPlaceholder) return configured;
  const mailbox = addressOf(login);
  return mailbox ? `NG Home <${mailbox}>` : placeholder;
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'default-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'default-refresh-secret',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
  },
  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map(stripTrailingSlashes)
      .filter(Boolean),
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED !== 'false',
    path: process.env.SWAGGER_PATH ?? 'docs',
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './uploads',
    sftp: {
      host: process.env.SFTP_HOST,
      port: parseInt(process.env.SFTP_PORT ?? '22', 10),
      username: process.env.SFTP_USERNAME,
      password: process.env.SFTP_PASSWORD,
      // Either password or privateKey — a key is preferred where the
      // server supports it, but ssh2-sftp-client accepts either.
      privateKey: process.env.SFTP_PRIVATE_KEY,
      // Root directory on the remote server documents get written under —
      // never the server's actual root, so a bad path can't escape it.
      basePath: process.env.SFTP_BASE_PATH ?? '/ng-home-documents',
    },
  },
  // Locks secrets saved from the platform console (the mail password). Falls back
  // to JWT_ACCESS_SECRET when unset; once set, it must not change.
  settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY,
  mail: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: resolveMailFrom(process.env.SMTP_FROM, process.env.SMTP_USER),
    appUrl: stripTrailingSlashes(process.env.APP_URL ?? 'http://localhost:3001'),
  },
});
