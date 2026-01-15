export const dynamic = 'force-dynamic';

export async function GET() {
  const response = await fetch('http://localhost:3333/events', {
    headers: {
      'Cache-Control': 'no-cache',
    },
  });

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}   