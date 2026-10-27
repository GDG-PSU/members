import { handleApiError, jsonOk, requestId } from '@/lib/api';
import { listPublicEvents } from '@/lib/public/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const events = await listPublicEvents(60);
    return jsonOk({ events, generatedAt: new Date().toISOString(), requestId: id });
  } catch (error) {
    return handleApiError(error, id);
  }
}
