import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
  orgId?: string;
  userId?: string;
}

const store = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return store.getStore();
}

export function getRequestId(): string | undefined {
  return store.getStore()?.requestId;
}
