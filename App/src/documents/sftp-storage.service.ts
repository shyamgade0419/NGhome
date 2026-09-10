import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SftpClient from 'ssh2-sftp-client';

/**
 * A multi-line private key pasted into an environment variable often arrives
 * as one line with literal `\n` sequences — how Coolify, Docker env files and
 * most CI systems represent a newline they cannot store. ssh2 then fails with
 * "Cannot parse privateKey", which reads like a bad key rather than a
 * formatting problem. A real PEM never contains a literal backslash-n, so
 * turning them back into newlines is safe either way. Also tolerates Windows
 * line endings from a key saved on Windows.
 */
export function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim() + '\n';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Thin wrapper around ssh2-sftp-client for the one storage backend this
 * deployment actually uses — an SFTP server the society already runs,
 * not a cloud bucket. A fresh connection per operation (rather than one
 * held open) trades a little latency for never having to reason about a
 * long-lived connection dying between requests in a multi-instance API.
 */
@Injectable()
export class SftpStorageService implements OnModuleInit {
  private readonly logger = new Logger(SftpStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  private getConnectOptions() {
    const host = this.configService.get<string>('storage.sftp.host');
    const port = this.configService.get<number>('storage.sftp.port');
    const username = this.configService.get<string>('storage.sftp.username');
    const password = this.configService.get<string>('storage.sftp.password');
    const privateKey = this.configService.get<string>('storage.sftp.privateKey');

    if (!host || !username || (!password && !privateKey)) {
      throw new InternalServerErrorException(
        'File storage is not configured — set SFTP_HOST, SFTP_USERNAME and SFTP_PASSWORD (or SFTP_PRIVATE_KEY).',
      );
    }

    return {
      host,
      port,
      username,
      ...(privateKey ? { privateKey: normalizePrivateKey(privateKey) } : { password }),
      readyTimeout: 20_000,
    };
  }

  /**
   * Reports on every boot whether storage works — and, when it doesn't, what
   * to change — in the container log.
   *
   * The one question nobody can answer without trying is where the account is
   * allowed to write. The base path is used as an absolute path from `/`.
   * If the SFTP account is jailed to its home folder, `/` means that folder
   * and a path like /nghome-storage just works; if it is not, `/` is the
   * server's real root and the same path fails with permission denied. So this
   * connects, asks the server what the home folder is, and proves a write
   * actually succeeds — then either confirms it or suggests the exact value.
   *
   * Not awaited: an unreachable storage server must never delay startup, or the
   * healthcheck fails and a deploy rolls back over a problem that only
   * affects uploads.
   */
  onModuleInit() {
    try {
      this.getConnectOptions();
    } catch {
      this.logger.warn(
        'SFTP is not configured — document and receipt uploads will fail until ' +
          'SFTP_HOST, SFTP_USERNAME and SFTP_PASSWORD (or SFTP_PRIVATE_KEY) are set.',
      );
      return;
    }
    // The .catch is load-bearing, not tidiness. This promise is deliberately
    // not awaited, so anything thrown inside it has no caller to land on — and
    // Node 22 terminates the process on an unhandled rejection. Without it, a
    // check whose whole point is never to block startup could kill the API.
    void this.checkStorage()
      .then((r) => {
        if (r.ok) {
          this.logger.log(`SFTP ready — writing under ${r.base} (account home: ${r.home})`);
        } else {
          this.logger.error(`SFTP check failed — uploads will not work: ${r.reason}`);
        }
      })
      .catch((err) => this.logger.error(`SFTP check could not run: ${describe(err)}`));
  }

  async checkStorage(): Promise<
    { ok: true; home: string; base: string } | { ok: false; reason: string }
  > {
    const base = this.getBasePath();
    let home = '(unknown)';
    let sftp: SftpClient;
    try {
      sftp = new SftpClient();
      await sftp.connect(this.getConnectOptions());
    } catch (err) {
      return { ok: false, reason: `could not log in — ${describe(err)}` };
    }
    try {
      home = await sftp.realPath('.');
      if (!(await sftp.exists(base))) await sftp.mkdir(base, true);
      // Proving the write, not just the folder: a folder can exist and still
      // refuse new files, and that would only surface on a resident's upload.
      const probe = `${base}/.nghome-write-check-${Date.now()}`;
      await sftp.put(Buffer.from('ok'), probe);
      await sftp.delete(probe);
      return { ok: true, home, base };
    } catch (err) {
      const hint =
        home !== '(unknown)' && !base.startsWith(home)
          ? ` The account's home is ${home} — try SFTP_BASE_PATH=${home}/nghome-storage.`
          : '';
      return { ok: false, reason: `cannot write to ${base} — ${describe(err)}.${hint}` };
    } finally {
      await sftp.end().catch(() => {});
    }
  }

  getBasePath(): string {
    return this.configService.get<string>('storage.sftp.basePath') ?? '/ng-home-documents';
  }

  async upload(buffer: Buffer, remotePath: string): Promise<void> {
    // Read outside the try — this throws its own specific, actionable
    // message ("set SFTP_HOST, SFTP_USERNAME...") when storage isn't
    // configured. Evaluating it as sftp.connect()'s argument put that
    // throw inside the try below, where the catch-all swallowed it and
    // replaced it with a generic "Failed to store the uploaded file." —
    // exactly the unconfigured case masking itself as an unrelated error.
    const options = this.getConnectOptions();
    const sftp = new SftpClient();
    try {
      await sftp.connect(options);
      const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
      if (dir && !(await sftp.exists(dir))) {
        await sftp.mkdir(dir, true);
      }
      await sftp.put(buffer, remotePath);
    } catch (err) {
      this.logger.error(`SFTP upload failed for ${remotePath}: ${err}`);
      throw new InternalServerErrorException('Failed to store the uploaded file.');
    } finally {
      await sftp.end().catch(() => {});
    }
  }

  async download(remotePath: string): Promise<Buffer> {
    const options = this.getConnectOptions();
    const sftp = new SftpClient();
    try {
      await sftp.connect(options);
      const data = await sftp.get(remotePath);
      return Buffer.isBuffer(data) ? data : Buffer.from(data as string);
    } catch (err) {
      this.logger.error(`SFTP download failed for ${remotePath}: ${err}`);
      throw new InternalServerErrorException('Failed to retrieve the file.');
    } finally {
      await sftp.end().catch(() => {});
    }
  }

  /** Best-effort — a document row shouldn't fail to delete because storage
   *  isn't configured, the remote file was already gone, or the server was
   *  briefly unreachable, so getConnectOptions() deliberately stays inside
   *  the try here (unlike upload/download) — this one method's contract is
   *  "never throw", and the catch-all below is what honors that. */
  async remove(remotePath: string): Promise<void> {
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.getConnectOptions());
      if (await sftp.exists(remotePath)) {
        await sftp.delete(remotePath);
      }
    } catch (err) {
      this.logger.warn(`SFTP delete failed for ${remotePath}: ${err}`);
    } finally {
      await sftp.end().catch(() => {});
    }
  }
}
