# 008 — Popup message never reached the player iframe

**Status:** Fixed
**Severity:** High (extension unusable on embedded players)
**Category:** Messaging
**Platforms:** Videasy, Braflix, and every site whose `<video>` is inside
a cross-origin iframe
**Discovered:** The popup's "Start selection" button did nothing on videasy,
even though the content script was demonstrably running in the iframe.

## Symptom

The extension's toolbar icon was present. Clicking "Start selection" in the
popup did nothing. No banner appeared over the video. The iframe's own
console confirmed the content script was running there (via
`document.getElementById('subany-extension-root')`), but the popup command
never reached it. The top frame — which had no video — received the message
and did nothing.

## Root cause

The popup used the standard extension messaging API:

```ts
await browser.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
```

Without a `frameId` option, `tabs.sendMessage` delivers the message to the
**top frame only**. Cross-origin iframes are separate frames with separate
content-script instances. The top frame received the message, had no
`<video>` element, and correctly did nothing. The player frame — which had
the video and the caption — never heard about it.

This is a documented behaviour of the Chrome Extension messaging API. It
is not obvious until it bites, and it always bites on players whose
`<video>` lives in an iframe.

## Fix

The popup broadcasts to every frame in the tab.

```ts
async function sendToAllFrames(tabId: number, message: { type: string }): Promise<void> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (Array.isArray(frames) && frames.length > 0) {
      await Promise.all(
        frames.map((f) =>
          chrome.tabs.sendMessage(tabId, message, { frameId: f.frameId }).catch(() => {}),
        ),
      );
      return;
    }
  } catch { /* webNavigation not granted */ }

  // Fallback: send to frames 0–15 and ignore misses.
  await Promise.all(
    Array.from({ length: 16 }, (_, frameId) =>
      chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => {}),
    ),
  );
}
```

Every content-script instance in the tab receives the message. The instance
that owns a `<video>` accepts it (via `canOwnSelectionFrame()`); the others
decline silently. This requires the `webNavigation` permission for the
primary path; the fallback works without it.

## Why this is general

Any site that embeds its player in a cross-origin iframe has this topology.
The top-frame-only default of `tabs.sendMessage` is a common footgun in
extension development, especially for extensions that interact with
embedded media. The fix is the same regardless of which player is in the
iframe.

`window.postMessage` is not a substitute — it is a page-level API and does
not cross the extension's messaging boundary. The correct fix is to
broadcast through `chrome.tabs.sendMessage` with an explicit `frameId`.

## Invariant

**Popup broadcasts go to every frame in the tab, never just to the top
frame. Frames filter themselves based on whether they contain a video.**

## Regression test

1. Load a site whose player is inside a cross-origin iframe.
2. Click "Start selection" in the popup.
3. The banner should appear over the video in the player frame.
4. Click a caption. It should lock.
5. The top frame should show no extension UI.
6. Same test on a same-origin page — the top frame should handle it directly.
