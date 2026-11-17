import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'jsdom',include:['web/poc/shadcn/**/*.interaction.tsx'],setupFiles:['web/poc/shadcn/test-setup.ts'],environmentOptions:{jsdom:{url:'http://localhost:5175/shadcn/'}},testTimeout:10000}});
