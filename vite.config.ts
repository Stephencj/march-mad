import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,glb,png,jpg,webp,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\.(?:mp3|ogg|wav)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: { maxEntries: 50 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'anim-viewer': path.resolve(__dirname, 'anim-viewer.html'),
        'level-editor': path.resolve(__dirname, 'level-editor.html'),
        'player-editor': path.resolve(__dirname, 'player-editor.html'),
        'mocap-editor': path.resolve(__dirname, 'mocap-editor.html'),
        'face-editor': path.resolve(__dirname, 'face-editor.html'),
        'face-mirror': path.resolve(__dirname, 'face-mirror.html'),
      },
    },
  },
});
