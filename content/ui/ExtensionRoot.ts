// ui/ExtensionRoot.ts

import { createRoot, type Root } from 'react-dom/client';

/**
 * Owns the Shadow DOM host element and the React root that renders inside it.
 *
 * The extension is deliberately isolated inside a Shadow root so that:
 *   - the host page's CSS cannot restyle SubtitleOverlay / Tooltip
 *   - SubtitleOverlay / Tooltip CSS cannot leak into the host page
 *   - z-index and pointer-events conflicts are self-contained
 *
 * One instance per content script. `attach()` is idempotent — safe to call
 * again after a hot-reload-style remount.
 */
export class ExtensionRoot {
  private hostElement: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private root: Root | null = null;

  /**
   * Create the host element, attach the shadow root, mount the React root.
   * No-op if already attached.
   *
   * Matches the original startup sequence:
   *   const hostElement = document.createElement('div');
   *   hostElement.id = 'subany-extension-root';
   *   const shadowRoot = hostElement.attachShadow({ mode: 'open' });
   *   document.body.appendChild(hostElement);
   *   const reactRoot = createRoot(shadowRoot);
   */
  attach(): Root {
    if (this.root && this.hostElement && document.documentElement.contains(this.hostElement)) {
      return this.root;
    }

    const host = document.createElement('div');
    host.id = 'subany-extension-root';
    // Keep the extension host above page content without depending on child
    // z-index values leaking into the document's stacking context.
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);

    this.hostElement = host;
    this.shadowRoot = shadow;
    this.root = createRoot(shadow);
    return this.root;
  }

  /**
   * Return the current React root. Throws if `attach()` has not been called.
   * ContentRenderer calls this lazily so it can be constructed before the
   * host is mounted.
   */
  getRoot(): Root {
    if (!this.root) return this.attach();
    return this.root;
  }

  /**
   * The host element id, exposed so detection code that filters out the
   * extension's own DOM can match it (candidate scorers already hard-code
   * `'subany-extension-root'`, but a single source of truth is nicer).
   */
  getHostElement(): HTMLDivElement | null {
    return this.hostElement;
  }

  /**
   * Unmount React and remove the host element. Idempotent.
   */
  dispose(): void {
    try {
      this.root?.unmount();
    } catch (_) {
      /* React can throw if the root was already unmounted or the host was
         removed from the document first. Both are recoverable. */
    }
    this.root = null;
    this.shadowRoot = null;

    if (this.hostElement && this.hostElement.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
    }
    this.hostElement = null;
  }
}