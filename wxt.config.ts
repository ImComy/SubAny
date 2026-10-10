import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  browser: 'chrome',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SubAny',
    description: 'Translate subtitles on any video site while hovering over them.',
    version: '0.1.0',
    permissions: ['activeTab', 'storage', 'scripting', 'webNavigation'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'SubAny',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
