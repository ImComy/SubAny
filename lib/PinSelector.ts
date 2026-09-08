export interface PinSelectorEvents {
  onHoverCandidate: (element: HTMLElement | null, point: { x: number; y: number }) => void;
  onSelect: (element: HTMLElement) => void;
  onCancel: () => void;
}

export class PinSelector {
  private active = false;
  private isDragging = false;
  private pinElement: HTMLElement | null = null;
  private overlayElement: HTMLElement | null = null;
  private currentCandidate: HTMLElement | null = null;
  private events: PinSelectorEvents;

  constructor(events: PinSelectorEvents) {
    this.events = events;
  }

  start(initialX = window.innerWidth / 2, initialY = 160) {
    if (this.active) return;
    this.active = true;
    this.createDom(initialX, initialY);
    this.bindEvents();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.isDragging = false;
    this.unbindEvents();
    if (this.pinElement?.parentElement) {
      this.pinElement.parentElement.removeChild(this.pinElement);
    }
    if (this.overlayElement?.parentElement) {
      this.overlayElement.parentElement.removeChild(this.overlayElement);
    }
    this.pinElement = null;
    this.overlayElement = null;
    this.currentCandidate = null;
  }

  private createDom(x: number, y: number) {
    // Transparent fullscreen drag canvas
    const overlay = document.createElement('div');
    overlay.id = 'subany-pin-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      background: rgba(15, 23, 42, 0.2);
      cursor: crosshair;
      user-select: none;
    `;
    document.body.appendChild(overlay);
    this.overlayElement = overlay;

    // Compact pointy pin needle container
    const pin = document.createElement('div');
    pin.id = 'subany-pin-badge';
    pin.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      transform: translate(-50%, -100%);
      z-index: 2147483645;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: grab;
      touch-action: none;
      filter: drop-shadow(0 8px 24px rgba(6, 182, 212, 0.6));
      transition: transform 0.1s ease-out;
    `;

    // Pointy needle SVG icon with precise bottom tip
    pin.innerHTML = `
      <div id="subany-pin-label" style="
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid rgba(56, 189, 248, 0.5);
        color: #38bdf8;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 9999px;
        white-space: nowrap;
        margin-bottom: 4px;
        pointer-events: none;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      ">Drag pin onto subtitles</div>

      <div style="position: relative; width: 34px; height: 44px;">
        <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
          <defs>
            <linearGradient id="subany-pin-grad" x1="0" y1="0" x2="34" y2="44" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#38bdf8"/>
              <stop offset="60%" stop-color="#0284c7"/>
              <stop offset="100%" stop-color="#0f172a"/>
            </linearGradient>
            <filter id="subany-pin-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>
          <!-- Outer Sharp Pointy Pin Body -->
          <path d="M17 42C17 42 2 24.5 2 15C2 6.71573 8.71573 0 17 0C25.2843 0 32 6.71573 32 15C32 24.5 17 42 17 42Z" fill="url(#subany-pin-grad)" stroke="#7dd3fc" stroke-width="1.5"/>
          <!-- Inner Core Pulse -->
          <circle cx="17" cy="14" r="6" fill="#ffffff" filter="url(#subany-pin-glow)"/>
          <circle cx="17" cy="14" r="3" fill="#0369a1"/>
          <!-- Sharp Needle Tip Dot -->
          <circle cx="17" cy="42" r="2" fill="#38bdf8"/>
        </svg>
      </div>
    `;

    document.body.appendChild(pin);
    this.pinElement = pin;
  }

  private bindEvents() {
    if (!this.pinElement || !this.overlayElement) return;

    this.pinElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private unbindEvents() {
    this.pinElement?.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    this.isDragging = true;
    if (this.pinElement) {
      this.pinElement.style.cursor = 'grabbing';
      this.pinElement.style.transform = 'translate(-50%, -100%) scale(1.15)';
      const label = this.pinElement.querySelector('#subany-pin-label') as HTMLElement | null;
      if (label) label.style.opacity = '0.4';
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging || !this.pinElement) return;
    const x = e.clientX;
    const y = e.clientY;

    this.pinElement.style.left = `${x}px`;
    this.pinElement.style.top = `${y}px`;

    // Detect element under the needle tip (x, y)
    if (this.pinElement) this.pinElement.style.pointerEvents = 'none';
    if (this.overlayElement) this.overlayElement.style.pointerEvents = 'none';

    const under = document.elementFromPoint(x, y) as HTMLElement | null;

    if (this.pinElement) this.pinElement.style.pointerEvents = 'auto';
    if (this.overlayElement) this.overlayElement.style.pointerEvents = 'auto';

    if (under && under !== document.body && under !== document.documentElement) {
      this.currentCandidate = under;
      this.events.onHoverCandidate(under, { x, y });
    } else {
      this.currentCandidate = null;
      this.events.onHoverCandidate(null, { x, y });
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.pinElement) {
      this.pinElement.style.cursor = 'grab';
      this.pinElement.style.transform = 'translate(-50%, -100%) scale(1)';
    }

    if (this.currentCandidate) {
      const selected = this.currentCandidate;
      this.stop();
      this.events.onSelect(selected);
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.events.onCancel();
      this.stop();
    }
  };
}
