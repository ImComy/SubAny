# 012 — Page CSS hid the extension host

**Status:** Fixed
**Severity:** High
**Category:** Environment
**Platforms:** TryEmbed, JWPlayer
**Discovered:** The extension host disappeared when the page applied body-wide CSS filters or `display: none`

## Symptom

The extension renders nothing, even though it is active and the page has subtitles. The host element seems to vanish or fade out, leaving no overlay available for selection or translation.

## Root cause

The extension host was appended to `document.body`. Some pages apply global CSS rules such as `body > * { display: none; }`, `opacity: 0`, or transforms that hide the extension container along with the rest of the page content. The host therefore disappeared even though the extension remained loaded.

## Fix

The host was moved to `document.documentElement` instead of `document.body`, which avoids the body-directed selectors that pages commonly use. The overlay is now mounted on a stable root that is not affected by the page's `body > *` rules.

```ts
document.documentElement.appendChild(host);
```

This keeps the extension visible even when a site intentionally hides or clears content under `body`.

## Why this is general

Any page that re-styles or clears the body subtree can hide an extension mounted there. Moving the host to the root element is a common and robust defense against body-level CSS takeover. The fix is general across pages with custom styling and browser-specific embedding wrappers.

## Invariant

The extension host must be attached to the document root, not a node that page CSS may hide or reset.

## Regression test

1. Open a page with `body > *` CSS that hides content.
2. Confirm the extension host remains visible without being removed from the DOM.
3. Trigger a subtitle selection and confirm the overlay renders correctly.
4. Repeat on a standard page to ensure no regressions in the default host placement.
