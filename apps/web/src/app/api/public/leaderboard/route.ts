import { leaderboardQuerySchema } from '@gdg/contracts';
import { handleApiError, jsonOk, requestId } from '@/lib/api';
import { countLeaderboard, listLeaderboard } from '@/lib/public/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const url = new URL(request.url);
    const parsed = leaderboardQuerySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });
    const limit = parsed.success ? parsed.data.limit : 25;
    const offset = parsed.success ? parsed.data.offset : 0;

    const [entries, total] = await Promise.all([
      listLeaderboard(limit, offset),
      countLeaderboard(),
    ]);
    return jsonOk({
      entries,
      pagination: { limit, offset, total },
      generatedAt: new Date().toISOString(),
      requestId: id,
    });
  } catch (error) {
    return handleApiError(error, id);
  }
}
