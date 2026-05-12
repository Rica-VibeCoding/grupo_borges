const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const headers = new Headers({
    'Content-Type': request.headers.get('content-type') ?? 'application/json',
  });
  const reviewerSlug = request.headers.get('x-reviewer-slug');
  if (reviewerSlug) headers.set('X-Reviewer-Slug', reviewerSlug);

  const upstream = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    headers,
    body: await request.text(),
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
