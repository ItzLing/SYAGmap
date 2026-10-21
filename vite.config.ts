import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error plain JS module
import jsonApi from './server/api.mjs';

export default defineConfig({
  plugins: [tailwindcss(), jsonApi()],
  server: { port: 5173 },
});
