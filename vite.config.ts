import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 既定は node（純粋関数のテストが大半で、DOM の起動は遅い）。
    // DOM が要るテストはファイル先頭に `// @vitest-environment jsdom` を書く。
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
