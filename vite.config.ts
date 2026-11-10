
  import { defineConfig, loadEnv, type Plugin } from 'vite';
  import react from '@vitejs/plugin-react-swc';
  import tailwindcss from '@tailwindcss/vite';
  import path from 'path';
  import fs from 'fs';
  import { VitePWA } from 'vite-plugin-pwa';
  import { sentryVitePlugin } from '@sentry/vite-plugin';
  import { buildTimestampFrom, sentryUploadOptions } from './scripts/sentryUpload.mjs';

  const useHttps = process.env.VITE_HTTPS === 'true';
  const httpsConfig = useHttps && fs.existsSync(path.resolve(__dirname, '.certs/cert.pem'))
    ? { cert: fs.readFileSync(path.resolve(__dirname, '.certs/cert.pem')), key: fs.readFileSync(path.resolve(__dirname, '.certs/key.pem')) }
    : undefined;

  // One timestamp per build: the app shows it as __BUILD_TIMESTAMP__ and
  // build/version.json publishes it, so an open app can tell a newer build is
  // live (src/hooks/useAppUpdateNotice.ts). It is also the Sentry release,
  // gigwrangler@<timestamp>; deploy_prod.sh passes BUILD_TIMESTAMP so the edge
  // functions' SENTRY_RELEASE matches (A18).
  const buildTimestamp = buildTimestampFrom(process.env);

  const versionFilePlugin = (): Plugin => ({
    name: 'gigwrangler-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: buildTimestamp }),
      });
    },
  });

  export default defineConfig(({ mode }) => {
  // A18: with SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT (from the environment or
  // .env.production.local), the build emits hidden source maps, uploads them to Sentry under the
  // release and deletes them. Without them, no maps and no upload.
  const sentryUpload = sentryUploadOptions(loadEnv(mode, process.cwd(), ''), `gigwrangler@${buildTimestamp}`);
  return {
    plugins: [
      tailwindcss(),
      react(),
      versionFilePlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        manifest: {
          name: 'GigWrangler',
          short_name: 'GigWrnglr',
          description: 'Production and Event Management Platform',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          // The service worker needs no source map; it would otherwise follow build.sourcemap (A18).
          sourcemap: false,
          skipWaiting: true,
          clientsClaim: true,
          // Explicit allowlist so every client-side (react-router) route falls
          // back to index.html instead of being silently rejected by the SW's
          // navigation-fallback route — only exclude actual API/asset requests.
          navigateFallbackAllowlist: [/^(?!\/api\/).*/],
          // public/static/404.html is Cloudflare's not-found page for missing
          // chunks, never a page the app shows. (Restates Workbox's default
          // node_modules ignore, which setting globIgnores replaces.)
          // version.json must always come from the network, never the
          // precache, or the version check would only ever see this build.
          globIgnores: ['**/node_modules/**/*', 'static/404.html', 'version.json'],
          // Push notifications: showing them and opening the app from a tap (public/push-sw.js).
          importScripts: ['push-sw.js'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
          navigateFallbackAllowlist: [/^(?!\/api\/).*/],
        }
      }),
      // Last, so it sees the final output.
      ...(sentryUpload ? [sentryVitePlugin(sentryUpload)] : []),
    ],
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    },
    build: {
      target: 'esnext',
      outDir: 'build',
      // Hashed JS/CSS go in /static/, not Vite's default /assets/, because
      // /assets/... are app routes (equipment). public/static/404.html makes
      // Cloudflare Pages answer a missing build file with a real 404 there,
      // while every other path keeps the SPA fallback to index.html.
      assetsDir: 'static',
      // Only for the Sentry upload; 'hidden' leaves no sourceMappingURL in the shipped files.
      sourcemap: sentryUpload ? 'hidden' : false,
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      open: true,
      ...(httpsConfig ? { https: httpsConfig } : {}),
    },
  };
  });
