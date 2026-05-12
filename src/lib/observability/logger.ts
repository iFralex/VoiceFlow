import { Axiom } from '@axiomhq/js';

import { env } from '@/lib/env';

import { getRequestContext } from './request-context';

const axiom = env.AXIOM_TOKEN ? new Axiom({ token: env.AXIOM_TOKEN }) : null;

export interface LogContext {
  org_id?: string;
  user_id?: string;
  call_id?: string;
  campaign_id?: string;
  request_id?: string;
  [key: string]: unknown;
}

async function write(level: string, message: string, ctx: LogContext = {}): Promise<void> {
  const reqCtx = getRequestContext();

  let requestId: string | undefined = reqCtx?.requestId;
  let orgId: string | undefined = reqCtx?.orgId;
  let userId: string | undefined = reqCtx?.userId;

  // Fallback: read correlation fields from Next.js request headers when
  // AsyncLocalStorage is empty (server components, server actions, route handlers).
  if (!requestId && !orgId && !userId) {
    try {
      const { headers } = await import('next/headers');
      const h = await headers();
      requestId = h.get('x-request-id') ?? undefined;
      orgId = h.get('x-org-id') ?? undefined;
      userId = h.get('x-user-id') ?? undefined;
    } catch {
      // Not in a Next.js server context (edge runtime, tests, client)
    }
  }

  const enriched = {
    level,
    message,
    ts: new Date().toISOString(),
    org_id: orgId,
    user_id: userId,
    request_id: requestId,
    ...ctx,
  };

  if (env.NODE_ENV !== 'production') {
    if (level === 'error') {
      console.error(enriched);
    } else if (level === 'warn') {
      console.warn(enriched);
    } else {
      console.log(enriched);
    }
  }

  if (axiom && env.AXIOM_DATASET) {
    try {
      await axiom.ingest(env.AXIOM_DATASET, [enriched]);
    } catch {
      // Axiom ingestion errors must not crash the request
    }
  }
}

export const logger = {
  info(msg: string, ctx?: LogContext): Promise<void> {
    return write('info', msg, ctx);
  },
  warn(msg: string, ctx?: LogContext): Promise<void> {
    return write('warn', msg, ctx);
  },
  error(msg: string, ctx?: LogContext): Promise<void> {
    return write('error', msg, ctx);
  },
};
