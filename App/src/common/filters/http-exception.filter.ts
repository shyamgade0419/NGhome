import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj['message'] as string) || message;
        errors = resObj['errors'];
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.CONFLICT;
      message = this.handlePrismaError(exception);
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
    } else if (exception instanceof MulterError) {
      // Thrown by FileInterceptor's own multipart parsing, before any
      // controller code runs — it is neither an HttpException nor a Prisma
      // error, so without this it fell into the generic 500 branch below
      // and an oversized upload read as "Internal server error" instead of
      // the actual, actionable reason.
      [status, message] = this.handleMulterError(exception);
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private handleMulterError(error: MulterError): [number, string] {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return [HttpStatus.PAYLOAD_TOO_LARGE, 'That file is too large. The limit is 10 MB.'];
      case 'LIMIT_UNEXPECTED_FILE':
        return [HttpStatus.BAD_REQUEST, 'Unexpected file field in the upload.'];
      default:
        return [HttpStatus.BAD_REQUEST, 'The upload could not be processed.'];
    }
  }

  private handlePrismaError(error: Prisma.PrismaClientKnownRequestError): string {
    switch (error.code) {
      case 'P2002':
        return 'A record with this value already exists';
      case 'P2025':
        return 'Record not found';
      case 'P2003':
        return 'Foreign key constraint failed';
      case 'P2014':
        return 'The change violates a required relation';
      default:
        return 'Database operation failed';
    }
  }
}
