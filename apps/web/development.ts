import type { Plugin, ProxyOptions } from "vite-plus";

export function developmentConfig() {
  const port = Number(process.env.ABRACODE_DEV_PORT ?? 5173);
  const backendPort = Number(process.env.ABRACODE_DEV_BACKEND_PORT ?? 4098);
  if (
    ![port, backendPort].every((value) => Number.isInteger(value) && value > 0 && value <= 65535) ||
    port === backendPort
  )
    throw new Error(
      "Expected distinct valid ABRACODE_DEV_PORT and ABRACODE_DEV_BACKEND_PORT values",
    );
  const origin = `http://127.0.0.1:${port}`;
  const target = `http://127.0.0.1:${backendPort}`;
  const proxy: ProxyOptions = {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (upstream, request) => {
        // The middleware below validates the original browser origin first.
        // Translate only that accepted origin for the private backend origin.
        if (request.headers.origin === origin) upstream.setHeader("origin", target);
        for (const header of [
          "authorization",
          "cookie",
          "forwarded",
          "x-forwarded-host",
          "x-forwarded-proto",
        ])
          upstream.removeHeader(header);
      });
    },
  };
  const boundary: Plugin = {
    name: "abra-development-origin",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          request.headers.host !== new URL(origin).host ||
          (request.headers.origin !== undefined && request.headers.origin !== origin) ||
          ["cross-site", "same-site"].includes(String(request.headers["sec-fetch-site"])) ||
          (!["GET", "HEAD"].includes(request.method ?? "") && request.headers.origin !== origin)
        ) {
          response.writeHead(403, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("Use the printed local AbraCode development URL.");
          return;
        }
        next();
      });
    },
  };
  return {
    boundary,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      cors: false as const,
      proxy: { "/api/": proxy, "/THIRD_PARTY_NOTICES.txt": proxy },
    },
  };
}
