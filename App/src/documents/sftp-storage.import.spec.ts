/**
 * The other SFTP spec replaces ssh2-sftp-client with a fake, so it cannot notice a wrong
 * import. This one loads the REAL package: the first production check failed with
 * "ssh2_sftp_client_1.default is not a constructor" because a default import reads
 * `.default`, which the CommonJS package does not have.
 */
import { ConfigService } from '@nestjs/config';
import { SftpStorageService } from './sftp-storage.service';

describe('SftpStorageService with the real ssh2-sftp-client', () => {
  it('builds a client and fails on the connection, not on the import', async () => {
    const service = new SftpStorageService(
      new ConfigService({ storage: { sftp: { host: '127.0.0.1', port: 1, username: 'u', password: 'p', basePath: '/nghome' } } }),
    );
    const result = await service.checkStorage();
    await new Promise((r) => setTimeout(r, 100)); // let the library's socket-close listener fire before the test ends
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('could not log in');
      expect(result.reason).not.toMatch(/constructor/i);
    }
  });
});
