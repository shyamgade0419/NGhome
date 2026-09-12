import { NextRequest, NextResponse } from 'next/server';

/**
 * Ingress size guard for BFF routes that buffer the entire request body
 * into memory before anything downstream gets a chance to reject it.
 *
 * The NestJS backend already caps file uploads at 10MB (Multer's
 * `limits.fileSize` on the `documents`/`payments` upload endpoints), but
 * that check runs on the parsed `file` field's own bytes, deep inside the
 * backend request — long after this Next.js route has already read the
 * *entire* incoming multipart body into memory via `req.formData()`
 * (there is no way to inspect or cap a multipart body's size while
 * streaming it without a manual multipart parser, which the backend
 * already has and this route deliberately doesn't duplicate). A request
 * that will ultimately be rejected as too large still costs this process
 * a full body-sized allocation before that rejection happens — this
 * check turns that into a cheap header check instead, for both the
 * multipart upload routes and the generic JSON proxy (which similarly
 * buffers the whole body via `req.text()`).
 *
 * This is a pragmatic ingress guard, not a hard guarantee: it trusts the
 * Content-Length header the client itself declares. A client can lie
 * about it or omit it and stream via chunked transfer-encoding — neither
 * is caught by a header check alone. It's deliberately fail-closed for
 * that reason: a missing or unparseable Content-Length is rejected as
 * "unknown", not assumed small, because every real client this app
 * talks to (browser `fetch` with a `FormData` or JSON string body, the
 * mobile app) sets it accurately — `fetch` computes it automatically for
 * both body types used here. Something that omits it is not a shape of
 * request this app's own clients ever produce.
 */
export function rejectIfTooLarge(req: NextRequest, maxBytes: number): NextResponse | null {
  const header = req.headers.get('content-length');
  const length = header ? Number(header) : NaN;
  if (!Number.isFinite(length) || length > maxBytes) {
    return NextResponse.json(
      { message: `Request body exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit.` },
      { status: 413 },
    );
  }
  return null;
}

// The backend's own file-size limit is 10MB (documents.controller.ts /
// payments.controller.ts, Multer `limits.fileSize`), applied to the
// uploaded file's own bytes. A multipart body carrying that file also
// carries boundary strings and a handful of small text fields (title,
// description, category, …) — a few hundred bytes to a few KB, nowhere
// close to 1MB — so 11MB comfortably covers a genuine 10MB file plus
// that overhead without weakening the effective limit in practice.
export const MULTIPART_UPLOAD_MAX_BYTES = 11 * 1024 * 1024;

// The generic proxy only ever forwards JSON control-plane payloads (no
// files) — every field it carries is short text, ids, or numbers. 1MB is
// generous headroom over anything a real form on this app sends (even a
// long meeting-minutes textarea is a few KB), while still bounding what
// req.text() will buffer for an ordinary API call.
export const JSON_BODY_MAX_BYTES = 1 * 1024 * 1024;
