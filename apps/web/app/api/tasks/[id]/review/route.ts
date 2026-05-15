const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

function isLoopbackApiBase(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

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
  const tailscaleUser = request.headers.get('tailscale-user-login');
  if (tailscaleUser && isLoopbackApiBase(API_BASE)) {
    headers.set('Tailscale-User-Login', tailscaleUser);
  }

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
