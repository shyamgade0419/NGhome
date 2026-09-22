/**
 * The contract every paginated service method must follow: return
 * {data, meta}, built with buildPaginationMeta. TransformInterceptor only
 * auto-unwraps that exact shape — anything else (e.g. the old
 * {data, total, page, limit}) gets treated as opaque payload and wrapped a
 * second time, so callers see response.data.data holding the whole object
 * instead of the array they expect. AccountsService.getTransactions shipped
 * with the wrong shape for this reason; this spec pins the interceptor's
 * side of that contract so the mistake is caught here next time, not by a
 * ledger that silently renders empty.
 */

import { of } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { TransformInterceptor } from './transform.interceptor';

function run(payload: unknown) {
  const interceptor = new TransformInterceptor();
  const handler: CallHandler = { handle: () => of(payload) };
  let result: unknown;
  interceptor
    .intercept({} as ExecutionContext, handler)
    .subscribe((v) => (result = v));
  return result;
}

describe('TransformInterceptor', () => {
  it('unwraps a {data, meta} pagination result to the top level', () => {
    const meta = { total: 2, page: 1, limit: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
    const data = [{ id: 't1' }, { id: 't2' }];

    expect(run({ data, meta })).toEqual({ success: true, data, meta });
  });

  it('does NOT unwrap {data, total, page, limit} — it has no `meta` key', () => {
    // This is the exact shape the old getTransactions() returned. Asserting
    // it stays double-wrapped documents why that shape is wrong, not just
    // that this one endpoint was fixed.
    const wrongShape = { data: [{ id: 't1' }], total: 1, page: 1, limit: 20 };

    expect(run(wrongShape)).toEqual({ success: true, data: wrongShape });
  });

  it('wraps a plain array as-is', () => {
    const rows = [{ id: 'a1' }];
    expect(run(rows)).toEqual({ success: true, data: rows });
  });

  it('wraps a plain object with no data/meta keys as-is', () => {
    const obj = { id: 'x1', name: 'Cash box' };
    expect(run(obj)).toEqual({ success: true, data: obj });
  });
});
