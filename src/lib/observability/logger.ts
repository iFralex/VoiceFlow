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
  const enriched = {
    level,
    message,
    ts: new Date().toISOString(),
    org_id: ctx.org_id ?? reqCtx?.orgId,
    user_id: ctx.user_id ?? reqCtx?.userId,
    request_id: ctx.request_id ?? reqCtx?.requestId,
    ...ctx,
  };

  if (env.NODE_ENV !== 'production') {
    console.log(enriched);
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
