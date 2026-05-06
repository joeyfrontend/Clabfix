import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
          ws: false
        }
      },
      watch: {
        ignored: [
          '**/clab-*', 
          '**/clab-*/**', 
          '**/*.bak', 
          '**/scratch/**',
          '**/*.clab.yml',
          '**/*.clab.yaml',
          '**/.topo.json'
        ],
      },
    },
  };
});
