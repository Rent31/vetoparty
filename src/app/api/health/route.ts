export const dynamic = 'force-static'

// Pure reachability document. The game has no server state, so this can live
// on the CDN with the rest of the application instead of invoking a function.
export function GET() {
  return Response.json({ ok: true, service: 'veto-party', mode: 'static' })
}
