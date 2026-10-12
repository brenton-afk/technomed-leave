import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify('test'),
    __APP_BUILT_AT__: JSON.stringify('2026-08-21T07:30:00.000Z')
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // api/ had no tests at all: it is checked by an esbuild pass that resolves
    // every import, which catches a missing export and nothing about behaviour.
    // lib/ is shared code that both the app and the serverless functions
    // import — publicHolidays.js is the first of it — so its tests have to be
    // collected too. They were not, and a new test file in there ran nowhere
    // and reported nothing.
    include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.js', 'lib/**/*.test.js'],
    // A fixed clock, so snapshots of anything date-derived stay stable.
    setupFiles: ['./src/test/setup.js']
  }
})
