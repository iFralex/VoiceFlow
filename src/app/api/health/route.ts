import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  return NextResponse.json({ status: 'ok', ts: new Date().toISOString() });
}

export const dynamic = 'force-dynamic';
