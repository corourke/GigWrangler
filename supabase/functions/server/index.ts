import { app } from './app.ts';

// Strip the Supabase function prefixes before Hono routes on the clean path —
// preserves the exact path handling of the legacy manual router.
Deno.serve((req) => {
  const url = new URL(req.url);
  let path = url.pathname;
  if (path.startsWith('/functions/v1')) path = path.substring('/functions/v1'.length);
  if (path.startsWith('/server')) path = path.substring('/server'.length);
  else if (path.startsWith('/make-server-de012ad4')) path = path.substring('/make-server-de012ad4'.length);
  if (!path.startsWith('/')) path = '/' + path;
  url.pathname = path;
  return app.fetch(new Request(url.toString(), req));
});
