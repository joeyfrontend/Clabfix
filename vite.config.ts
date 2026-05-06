import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { clabfixApi } from './src/server/plugin';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), clabfixApi({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/clab-*/**', '**/*.bak', '**/scratch/**'],
      },
    },
  };
});
