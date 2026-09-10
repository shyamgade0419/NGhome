/**
 * The production image has no terminal step for checking storage, so the
 * boot log is how a Coolify deploy says whether uploads will work. The part
 * worth pinning is the diagnosis: whether the base path is writable depends
 * on whether the SFTP account is jailed to its home folder, which only the
 * server knows.
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const client = {
  connect: jest.fn(),
  realPath: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  end: jest.fn(),
};
// ES-module shape: the service does `import SftpClient from 'ssh2-sftp-client'`,
// which compiles to a read of .default.
const SftpCtor = jest.fn().mockImplementation(() => client);
jest.mock('ssh2-sftp-client', () => ({ __esModule: true, default: SftpCtor }));

// Imported after the mock so the service picks up the fake client.
import { SftpStorageService } from './sftp-storage.service';

function serviceWith(sftp: Record<string, unknown>) {
  return new SftpStorageService(new ConfigService({ storage: { sftp } }));
}

const CONFIGURED = { host: 'novagade.in', port: 22, username: 'nghome', password: 'x', basePath: '/nghome-storage' };

beforeEach(() => {
  jest.clearAllMocks();
  client.connect.mockResolvedValue(undefined);
  client.realPath.mockResolvedValue('/home/novagade/nghome');
  client.exists.mockResolvedValue(true);
  client.mkdir.mockResolvedValue(undefined);
  client.put.mockResolvedValue(undefined);
  client.delete.mockResolvedValue(undefined);
  client.end.mockResolvedValue(undefined);
});

describe('SftpStorageService.checkStorage', () => {
  it('proves a real write, and cleans the probe up after itself', async () => {
    const result = await serviceWith(CONFIGURED).checkStorage();

    expect(result).toEqual({ ok: true, home: '/home/novagade/nghome', base: '/nghome-storage' });
    const [, probePath] = client.put.mock.calls[0];
    expect(probePath).toMatch(/^\/nghome-storage\/\.nghome-write-check-/);
    expect(client.delete).toHaveBeenCalledWith(probePath);
  });

  it('creates the base folder when it is missing', async () => {
    client.exists.mockResolvedValue(false);
    await serviceWith(CONFIGURED).checkStorage();
    expect(client.mkdir).toHaveBeenCalledWith('/nghome-storage', true);
  });

  it('suggests the exact base path when the account is not jailed to its home', async () => {
    // Not jailed: "/nghome-storage" is the server's real root, so it is refused.
    client.exists.mockResolvedValue(false);
    client.mkdir.mockRejectedValue(new Error('Permission denied'));

    const result = await serviceWith(CONFIGURED).checkStorage();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Permission denied');
      expect(result.reason).toContain('SFTP_BASE_PATH=/home/novagade/nghome/nghome-storage');
    }
  });

  it('reports a login failure as a login failure', async () => {
    client.connect.mockRejectedValue(new Error('All configured authentication methods failed'));

    const result = await serviceWith(CONFIGURED).checkStorage();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^could not log in/);
  });

  it('always closes the connection, even when the write fails', async () => {
    client.put.mockRejectedValue(new Error('Disk quota exceeded'));
    await serviceWith(CONFIGURED).checkStorage();
    expect(client.end).toHaveBeenCalled();
  });
});

describe('SftpStorageService boot check', () => {
  afterEach(() => jest.restoreAllMocks());

  it('says plainly when storage is not configured, without trying to connect', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    serviceWith({}).onModuleInit();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SFTP is not configured'));
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('never blocks startup waiting on the storage server', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    client.connect.mockReturnValue(new Promise(() => undefined)); // never settles

    // Synchronous return: if boot awaited this, a dead SFTP server would fail
    // the healthcheck and roll the deploy back.
    expect(serviceWith(CONFIGURED).onModuleInit()).toBeUndefined();
  });

  it('survives the check itself throwing, rather than killing the process', async () => {
    // Node 22 terminates on an unhandled rejection, and this promise is never
    // awaited — so the boot check must swallow its own failure.
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const svc = serviceWith(CONFIGURED);
    jest.spyOn(svc, 'checkStorage').mockRejectedValue(new Error('unexpected'));

    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not run: unexpected'));
  });

  it('normalises a private key before handing it to the client', async () => {
    const oneLineKey = '-----BEGIN KEY-----\\nAAAA\\n-----END KEY-----';
    await serviceWith({ ...CONFIGURED, password: undefined, privateKey: oneLineKey }).checkStorage();

    const [options] = client.connect.mock.calls[0];
    expect(options.privateKey).toBe('-----BEGIN KEY-----\nAAAA\n-----END KEY-----\n');
    expect(options.password).toBeUndefined();
  });
});
