/**
 * "Click to play" (GDD 2.6 "Look: Mouse (pointer lock). Overlay: Click to play", GDD 2.14 Opening).
 *
 * - ClickToPlay: the full-screen overlay. Activating it is the user gesture that pointer lock (and audio
 *   unlock) need. It is a real <button>, so Enter / Space work for keyboard-only players. Other screens
 *   (the Opening) can reuse it with show('touch') for "Tap to play".
 * - PointerLockGate: owns the desktop pointer lock for Input and shows the overlay during gameplay
 *   whenever the mouse is not locked.
 */
import { events } from '../core/Events';
import { t } from '../core/I18n';
import type { InputDevice } from '../core/Input';
import { icon } from './Svg';

export class ClickToPlay {
  private readonly el: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly offs: Array<() => void> = [];
  private tap = false;
  private shown = false;

  constructor(parent: HTMLElement, onActivate: () => void) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pg-click-to-play';
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '40',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'rgba(28, 20, 34, 0.42)',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      userSelect: 'none',
    });

    const pill = document.createElement('span');
    Object.assign(pill.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '14px',
      padding: '18px 34px 18px 26px',
      borderRadius: '999px',
      background: 'var(--panel, #fff4dc)',
      color: 'var(--ink, #3b2a1f)',
      boxShadow: '0 6px 0 var(--shadow-solid, #c9a066), 0 12px 28px rgba(28, 20, 34, 0.35)',
      fontSize: '28px',
      fontWeight: '800',
      letterSpacing: '0.02em',
    });
    const glyph = document.createElement('span');
    glyph.style.display = 'inline-flex';
    glyph.style.color = 'var(--accent-deep, #c4861b)';
    glyph.innerHTML = icon('play', 34);
    this.label = document.createElement('span');
    pill.append(glyph, this.label);
    el.appendChild(pill);

    const activate = (): void => onActivate();
    const noMenu = (e: Event): void => e.preventDefault();
    el.addEventListener('click', activate);
    el.addEventListener('contextmenu', noMenu);
    this.offs.push(
      () => el.removeEventListener('click', activate),
      () => el.removeEventListener('contextmenu', noMenu),
      events.on('lang:changed', () => this.refreshLabel()),
    );

    this.el = el;
    this.refreshLabel();
    parent.appendChild(el);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Shows "Tap to play" for touch, "Click to play" otherwise, and focuses it for keyboard players. */
  show(device: InputDevice): void {
    this.tap = device === 'touch';
    this.refreshLabel();
    if (this.shown) return;
    this.shown = true;
    this.el.style.display = 'flex';
    this.el.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.style.display = 'none';
    this.el.blur();
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.el.remove();
  }

  private refreshLabel(): void {
    const text = t(this.tap ? 'ui.play.tap' : 'ui.play.click');
    this.label.textContent = text;
    this.el.setAttribute('aria-label', text);
  }
}

/**
 * Desktop pointer lock for gameplay. Input tells it whether gameplay runs and which device is in use;
 * while gameplay runs with keyboard + mouse and the mouse is not locked, the overlay shows and clicking
 * it requests the lock. Leaving gameplay releases the lock, including one the browser grants late, after
 * gameplay ended (or after dispose) while the request was still pending.
 */
export class PointerLockGate {
  /** False on touch-only devices and browsers without the Pointer Lock API. */
  readonly supported: boolean;

  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement;
  private readonly onUnlock: (unexpected: boolean) => void;
  private readonly offs: Array<() => void> = [];
  private overlay: ClickToPlay | null = null;
  private isLocked = false;
  private pending = false;
  private expectUnlock = false;
  private gameplay = false;
  private device: InputDevice = 'kbm';
  private disposed = false;

  /** `onUnlock(unexpected)` runs when the lock is lost; unexpected = mid-gameplay via Esc or alt-tab. */
  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, onUnlock: (unexpected: boolean) => void) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.onUnlock = onUnlock;
    const touchOnly = media('(pointer: coarse)') && !media('(any-pointer: fine)');
    this.supported = typeof canvas.requestPointerLock === 'function' && !touchOnly;
    document.addEventListener('pointerlockchange', this.onChange);
    document.addEventListener('pointerlockerror', this.onError);
    this.offs.push(
      () => document.removeEventListener('pointerlockchange', this.onChange),
      () => document.removeEventListener('pointerlockerror', this.onError),
    );
  }

  get locked(): boolean {
    return this.isLocked;
  }

  /** Called on gameplay and device changes. Entering gameplay inside a user gesture locks right away. */
  sync(gameplay: boolean, device: InputDevice): void {
    if (this.disposed) return;
    const entering = gameplay && !this.gameplay;
    this.gameplay = gameplay;
    this.device = device;
    if (!gameplay) this.release();
    else if (entering && device === 'kbm' && hasUserActivation()) this.request();
    this.refresh();
  }

  /** Needs a user gesture; a refused request leaves the overlay up and the next click retries. */
  request(): void {
    if (this.disposed || !this.supported || this.isLocked || this.pending || this.device === 'touch') return;
    this.pending = true;
    try {
      const request: unknown = this.canvas.requestPointerLock();
      if (request instanceof Promise) request.catch(this.onError);
    } catch {
      this.onError(); // older browsers throw synchronously when the request is not allowed
    }
  }

  /** Frees the mouse on purpose. The unlock is expected, so it does not count as Esc (no pause tap). */
  release(): void {
    if (!this.isLocked) return;
    this.expectUnlock = true;
    document.exitPointerLock();
  }

  /** A request still pending keeps its listeners until it settles, so a late grant is released too. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gameplay = false;
    this.release();
    this.overlay?.dispose();
    this.overlay = null;
    if (!this.pending) this.detach();
  }

  private detach(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private refresh(): void {
    if (this.disposed) return;
    const show = this.gameplay && this.supported && !this.isLocked && !this.pending && this.device === 'kbm';
    if (show) {
      this.overlay ??= new ClickToPlay(this.uiRoot, () => this.request());
      this.overlay.show('kbm');
    } else {
      this.overlay?.hide();
    }
  }

  private readonly onChange = (): void => {
    this.pending = false;
    const locked = document.pointerLockElement === this.canvas;
    if (this.disposed) {
      // A request made before dispose() settled: give the mouse back and stop listening.
      if (locked) document.exitPointerLock();
      this.isLocked = false;
      this.detach();
      return;
    }
    if (locked !== this.isLocked) {
      this.isLocked = locked;
      if (!locked) {
        this.onUnlock(this.gameplay && !this.expectUnlock);
        this.expectUnlock = false;
      }
    }
    if (locked && !this.gameplay) this.release(); // granted after gameplay ended (menu, cutscene)
    this.refresh();
  };

  private readonly onError = (): void => {
    this.pending = false;
    if (this.disposed) this.detach();
    else this.refresh();
  };
}

function media(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

function hasUserActivation(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return activation?.isActive ?? false;
}
