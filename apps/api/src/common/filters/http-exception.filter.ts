import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '@hl/shared';

/** Single JSON error shape for every failure so clients branch on errorCode. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload: unknown = isHttp ? exception.getResponse() : null;

    let errorCode: string = ErrorCode.INTERNAL;
    let message: string | string[] = 'Something went wrong. Please try again.';

    if (typeof payload === 'object' && payload !== null) {
      const body = payload as Record<string, unknown>;
      if (typeof body.errorCode === 'string') errorCode = body.errorCode;
      if (typeof body.message === 'string' || Array.isArray(body.message)) {
        message = body.message as string | string[];
        // class-validator failures arrive as a string[] with no errorCode.
        if (errorCode === ErrorCode.INTERNAL) errorCode = ErrorCode.VALIDATION_FAILED;
      }
    } else if (isHttp) {
      message = exception.message;
    }

    if (statusCode === HttpStatus.TOO_MANY_REQUESTS) errorCode = ErrorCode.RATE_LIMITED;

    if (statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(statusCode).json({
      statusCode,
      errorCode,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
