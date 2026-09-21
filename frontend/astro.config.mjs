// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [
    react(),
  ],
  security: {
    checkOrigin: false,
  },
  vite: {
    worker: {
      format: 'es',
    },
    ssr: {
      noExternal: ['zustand', 'jose', 'sonner', 'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority', 'recharts', 'date-fns', 'react-markdown', 'framer-motion'],
    },
  },
});
