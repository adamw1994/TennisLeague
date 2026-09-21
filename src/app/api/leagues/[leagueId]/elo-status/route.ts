import { NextResponse } from 'next/server';
import { withDb } from '@/db/orm';
import { getEloStatus } from '@/modules/elo/queries';
import { DomainError } from '@/shared/errors';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
): Promise<Response> {
  const { leagueId } = await params;
  try {
    const status = await withDb(em => getEloStatus(em, leagueId));
    return NextResponse.json(status, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status =
      error instanceof DomainError && error.code === 'LEAGUE_NOT_FOUND'
        ? 404
        : error instanceof DomainError && error.code === 'FORBIDDEN_OPERATION'
          ? 409
          : 500;
    return NextResponse.json(
      { code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

