import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  browser: 'chrome',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SubAny',
    description: 'Translate subtitles on any video site while hovering over them.',
    version: '0.1.0',
    permissions: ['activeTab', 'storage', 'scripting'],
    host_permissions: ['<all_urls>'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
