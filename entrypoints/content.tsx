// entrypoints/content.ts

import { ContentApp } from '../content/ContentApp';

export default defineContentScript({
  matches: [
    '<all_urls>',
    'https://player.videasy.to/*',
    'https://player.videasy.net/*',
  ],
  allFrames: true,
  async main() {
    const app = new ContentApp();
    await app.start();

    // The content script lives for the lifetime of the page. WXT's HMR
    // in dev mode will call `main()` again on reload — if that becomes a
    // problem, hook `import.meta.hot` here to `app.dispose()` first.
  },
});