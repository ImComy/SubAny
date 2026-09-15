# 009 — Video-less frame startup guard broke mounting

**Status:** Fixed
**Severity:** High (extension stopped working everywhere)
**Category:** Lifecycle
**Platforms:** Videasy, all players whose video is inserted or sized after
the content script runs
**Discovered:** After adding a startup guard to avoid mounting in frames
without a video, the extension stopped working on every site.

## Symptom

The extension's listeners were never attached. No selection, no translation,
no overlay. `document.getElementById('subany-extension-root')` returned
`null` in every frame. The extension appeared to be installed but inert.

## Root cause

A startup guard had been added to `ContentApp.start()`:

```ts
if (!this.hasVideoInThisFrame()) {
  this.watchForVideoThenStart();
  return;
}
```

`watchForVideoThenStart()` attached a `MutationObserver` watching
`document.documentElement` for `childList` mutations, and called
`startFull()` when a `<video>` appeared.

On videasy and most React-based players, the `<video>` element is already
present in the DOM by the time the content script runs — but its
`getBoundingClientRect()` returns zero size because its parent hasn't been
laid out yet. `hasVideoInThisFrame()` required non-zero size, so it returned
`false`.

The observer only watched for childList changes (element insertion). The
video was already inserted; the transition that mattered was a **style**
change — the parent being laid out. The observer never fired. After an
8-second timeout it gave up. `startFull()` never ran.

## Fix

The guard was removed entirely. Every frame mounts unconditionally.

Filtering now happens only at the moment of action, via
`canOwnSelectionFrame()`:

```ts
private canOwnSelectionFrame(): boolean {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  return videos.some((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}
```

Frames without a real video mount the app, attach listeners, then decline
the `START_SELECTION` message when it arrives. The cost of mounting in a
video-less frame is negligible: one React root, a handful of event
listeners, one `chrome.storage` read, and then idle.

This also fixed the reverse problem: on pages where the video appeared
late, the previous code was racing the player's own layout. Mounting
unconditionally means the extension is always ready, and the video check
happens exactly when a video is needed.

## Why this is general

Any startup-time check that depends on the page having reached a
particular state will eventually race with the page. React players commonly
insert their `<video>` before laying it out. Native players commonly insert
it after the initial paint. There is no single moment when "the video
exists and is ready" is guaranteed by startup time.

The correct pattern is: mount, then filter at the point of use. At the
moment of a user click, the video either exists and is sized (the user is
looking at it) or it doesn't (the user can't click on it). No race.

## Invariant

**Mount unconditionally. Filter at the moment of action, never at startup.**

## Regression test

1. Load a videasy page with the extension installed. "Start selection"
   should work on first click.
2. Load a YouTube page. Same.
3. Load a page where the video appears a few seconds after load (an SPA
   route change, or a player that lazily inserts its `<video>`). "Start
   selection" should work once the video is visible.
4. Reload the extension while a video is playing. Everything still works.
