/** Stores the user-selected subtitle selector. Detection lives in content/detection. */
export class SubtitleManager {
  private lockedSelector: string | null = null;
  private onGlowTrigger?: (element: HTMLElement) => void;

  constructor(options?: { onGlowTrigger?: (element: HTMLElement) => void }) {
    this.onGlowTrigger = options?.onGlowTrigger;
  }

  setGlowCallback(callback: (element: HTMLElement) => void): void {
    this.onGlowTrigger = callback;
  }

  triggerGlow(element: HTMLElement): void {
    this.onGlowTrigger?.(element);
  }

  setLockedSelector(selector: string | null): void {
    this.lockedSelector = selector;
  }

  getLockedSelector(): string | null {
    return this.lockedSelector;
  }
}
