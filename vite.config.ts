import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error plain JS module
import jsonApi from './server/api.mjs';

export default defineConfig({
  // jsonApi() is the local JSON database + AI endpoint (/api). Without it the app runs "offline".
  plugins: [tailwindcss(), jsonApi()],
  server: {
    host: '127.0.0.1',
    port: 3000, // or 5174
  },
});
