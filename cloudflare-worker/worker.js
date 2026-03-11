/**
 * Cloudflare Worker — Firestore Proxy for רוח חשמונאית
 *
 * Proxies requests from api.ruach-hashmonaim.org to firestore.googleapis.com
 * This allows users behind internet filters to access the app.
 *
 * Deploy: wrangler deploy
 */

const ALLOWED_ORIGINS = [
  'https://ruach-hashmonaim.github.io',
  'https://app.ruach-hashmonaim.org',
  'https://ruach-hashmonaim.org',
  'http://localhost',
  'capacitor://localhost',  // Capacitor Android/iOS
  'https://localhost'       // Capacitor
];

const PROXY_TARGETS = {
  '/firestore/': 'https://firestore.googleapis.com/',
  '/identitytoolkit/': 'https://identitytoolkit.googleapis.com/',
  '/securetoken/': 'https://securetoken.googleapis.com/'
};

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o)) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-client, x-goog-request-params',
    'Access-Control-Max-Age': '86400',
  };
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const cors = getCorsHeaders(request);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Health check
  if (url.pathname === '/' || url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', service: 'ruach-proxy' }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Find matching proxy target
  let targetBase = null;
  let pathRemainder = null;

  for (const [prefix, target] of Object.entries(PROXY_TARGETS)) {
    if (url.pathname.startsWith(prefix)) {
      targetBase = target;
      pathRemainder = url.pathname.slice(prefix.length);
      break;
    }
  }

  if (!targetBase) {
    return new Response('Not Found', { status: 404, headers: cors });
  }

  // Build target URL
  const targetUrl = targetBase + pathRemainder + url.search;

  // Forward request
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    });

    // Clone response and add CORS headers
    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error', details: err.message }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}

export default {
  fetch: handleRequest,
};
