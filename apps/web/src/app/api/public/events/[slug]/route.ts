import { handleApiError, jsonError, jsonOk, requestId } from '@/lib/api';
import { getPublicEvent } from '@/lib/public/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const id = requestId(request);
  try {
    const { slug } = await context.params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return jsonError(400, 'bad_request', 'Invalid event slug.', id);
    }
    const data = await getPublicEvent(slug);
    if (!data) return jsonError(404, 'not_found', 'Event not found.', id);
    return jsonOk({ ...data, requestId: id });
  } catch (error) {
    return handleApiError(error, id);
  }
}
