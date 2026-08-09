export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const csp = [
      "default-src 'self'",
      "script-src 'self' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src https://www.youtube-nocookie.com",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self' https://checkout.stripe.com",
    ].join('; ');

    if (url.pathname === '/download' || url.pathname === '/download/') {
      const indexUrl = new URL('/index.html', url);
      const assetRequest = new Request(indexUrl.toString(), { method: 'GET', headers: request.headers });
      const response = await env.ASSETS.fetch(assetRequest);
      const headers = new Headers(response.headers);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('cache-control', 'no-store');
      headers.set('content-security-policy', csp);
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      headers.set('permissions-policy', 'accelerometer=(), autoplay=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    const response = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/download-assets/')) {
      const headers = new Headers(response.headers);
      headers.set('cache-control', url.pathname === '/download-assets/assets/app.js' || url.pathname === '/download-assets/assets/app.css' ? 'no-cache' : url.pathname.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return response;
  },
};
