import { Injectable, NestInterceptor, ExecutionContext, CallHandler, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // A file is the response itself. Wrapped, it is sent as JSON under the file's own content
        // type — the download arrives as `{"success":true,"data":{...}}` instead of the bytes.
        if (data instanceof StreamableFile) return data as unknown as ApiResponse<T>;
        if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          return {
            success: true,
            data: (data as { data: T }).data,
            meta: (data as { meta: Record<string, unknown> }).meta,
          };
        }
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
