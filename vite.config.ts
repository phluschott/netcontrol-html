import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const version = (process.env.GITHUB_SHA ?? 'local').slice(0, 7);

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // Ask before switching to a new version, so an update never reloads the page in the middle of a net.
      registerType: 'prompt',
      manifest: {
        name: 'Net Control',
        short_name: 'Net Control',
        description: 'Amateur radio net control logging',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'], navigateFallbackDenylist: [/^\/legacy\//] },
    }),
  ],
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] },
});
