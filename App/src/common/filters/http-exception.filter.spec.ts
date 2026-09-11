/**
 * The global filter is what turns an unexpected error into what the client
 * actually sees — it must never leak internals (stack traces, SQL, file
 * paths, secrets), and it must map errors that aren't HttpExceptions
 * (Prisma, Multer) onto a status/message a client can actually act on
 * instead of a bare 500.
 */

import { HttpStatus, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { GlobalExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: 'POST', url: '/api/v1/documents/upload' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as any;

  new GlobalExceptionFilter().catch(exception, host);
  return { status, body: json.mock.calls[0]?.[0] };
}

describe('GlobalExceptionFilter — unexpected errors never leak internals', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns a generic message for a bare Error, not its own message or stack', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('still logs the real error server-side, for diagnosis', () => {
    run(new Error('the real reason'));
    expect(errorSpy).toHaveBeenCalled();
  });

  it('passes an HttpException\'s own status and message through untouched', () => {
    const { status, body } = run(new BadRequestException('title is required'));
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe('title is required');
  });
});

describe('GlobalExceptionFilter — Prisma errors', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('maps a unique-constraint violation to 409 with a safe message, not the raw Prisma error', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`flatId`,`utrNumber`)', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    const { status, body } = run(err);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(body.message).toBe('A record with this value already exists');
    expect(JSON.stringify(body)).not.toContain('utrNumber');
  });

  it('maps a validation error to 400 with a safe message, not the raw Prisma error', () => {
    const err = Object.create(Prisma.PrismaClientValidationError.prototype);
    const { status, body } = run(err);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe('Invalid data provided');
  });
});

describe('GlobalExceptionFilter — Multer upload errors', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('maps an oversized file to 413, not a bare 500', () => {
    const { status, body } = run(new MulterError('LIMIT_FILE_SIZE'));
    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(body.message).toMatch(/too large/i);
  });

  it('maps an unexpected file field to 400', () => {
    const { status } = run(new MulterError('LIMIT_UNEXPECTED_FILE'));
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });
});
