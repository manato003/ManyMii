import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 対象はすべて純粋関数なので DOM は不要
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
