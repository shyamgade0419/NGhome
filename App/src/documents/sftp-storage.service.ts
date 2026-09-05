import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SftpClient from 'ssh2-sftp-client';

/**
 * Thin wrapper around ssh2-sftp-client for the one storage backend this
 * deployment actually uses — an SFTP server the society already runs,
 * not a cloud bucket. A fresh connection per operation (rather than one
 * held open) trades a little latency for never having to reason about a
 * long-lived connection dying between requests in a multi-instance API.
 */
@Injectable()
export class SftpStorageService {
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
      ...(privateKey ? { privateKey } : { password }),
    };
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
