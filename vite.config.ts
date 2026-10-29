import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/*.exe', '**/*.zip', '**/downloads/**', '**/.verification/**', '**/.npm-cache/**', '**/build/**', '**/dist/**', '**/screenshots/**', '**/tests/**'] },
  },
});
