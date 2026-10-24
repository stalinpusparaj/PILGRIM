/**
 * The full journey (DECISIONS #402). Chapters I-IV are free; Chapters V-XIII and the Epilogue need the `full`
 * entitlement, bought through RevenueCat in the Android shell (monthly or yearly subscription with a free trial,
 * or a one-time lifetime unlock; android BillingBridge.kt). The shell reports its state through
 * `window.__pilgrimNative.billing(json)`; the last owned state is remembered on the device so the journey stays
 * open offline, and is cleared only when the store says the purchase has ended.
 *
 * Without a store (a browser, or the shell has no RevenueCat key) nothing is locked, except in the demo build
 * (VITE_DEMO), which ends after Chapter IV as before. `?god=1` opens everything (debug builds).
 */
import { events } from './Events';
import { buildFlags, urlParams } from './Flags';

export const FREE_LAST_CHAPTER = 4;

export type Plan = 'monthly' | 'yearly' | 'lifetime';
export interface PlanInfo {
  /** Store-formatted price, e.g. "₹99.00". */
  price: string;
  /** ISO 8601 period ("P1M", "P1Y"); '' for the one-time unlock. */
  period?: string;
  /** ISO 8601 free trial ("P3D"), '' when none or the player has used it. */
  trial?: string;
}
export interface BillingState {
  status: 'connecting' | 'ready' | 'offline' | 'nokey' | 'none';
  owned: boolean;
  /** RevenueCat has answered about this player's purchases (not a guess). */
  confirmed: boolean;
  kind: '' | 'subscription' | 'lifetime';
  event: '' | 'purchased' | 'restored' | 'cancelled' | 'error';
  products: Partial<Record<Plan, PlanInfo>>;
}

interface BillingBridge {
  billingState(): string;
  buy(plan: string): void;
  restore(): void;
  manageSubscription(): void;
}
declare global {
  interface Window {
    PilgrimBilling?: BillingBridge;
  }
}
declare module './Events' {
  interface EventMap {
    /** The store's state changed (prices arrived, a purchase, a restore, a cancelled sheet). */
    'billing:changed': BillingState;
  }
}

const CACHE_KEY = 'pilgrim.entitlement.v1';
const NONE: BillingState = { status: 'none', owned: false, confirmed: false, kind: '', event: '', products: {} };

function cachedOwned(): boolean {
  try {
    return localStorage.getItem(CACHE_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(owned: boolean): void {
  try {
    if (owned) localStorage.setItem(CACHE_KEY, '1');
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* private mode: the store is asked again next launch */
  }
}

function parse(json: string): BillingState | null {
  try {
    const raw = JSON.parse(json) as Partial<BillingState>;
    if (typeof raw !== 'object' || raw === null) return null;
    return {
      status: raw.status ?? 'none',
      owned: raw.owned === true,
      confirmed: raw.confirmed === true,
      kind: raw.kind ?? '',
      event: raw.event ?? '',
      products: raw.products ?? {},
    };
  } catch {
    return null;
  }
}

let state: BillingState = NONE;

function bridge(): BillingBridge | null {
  return typeof window !== 'undefined' && window.PilgrimBilling ? window.PilgrimBilling : null;
}

export const entitlement = {
  /** The latest store state (prices, owned). */
  get state(): BillingState {
    return state;
  },
  /** True when this build sells the full journey (a store is wired) or is the demo build. */
  get gated(): boolean {
    if (urlParams.god) return false;
    // Offline still sells (locks) the journey: only a build with no RevenueCat key gives it away.
    return buildFlags.DEMO || (bridge() !== null && state.status !== 'nokey');
  },
  /** True when the Android shell's store bridge is present (whatever its state). */
  get hasStore(): boolean {
    return bridge() !== null && state.status !== 'nokey';
  },
  /** True when the store can sell right now (prices known). */
  get canBuy(): boolean {
    return bridge() !== null && state.status === 'ready' && Object.keys(state.products).length > 0;
  },
  /** True when the full journey is open. */
  get owned(): boolean {
    if (!this.gated) return true;
    if (buildFlags.DEMO && bridge() === null) return false;
    return state.owned || (!state.confirmed && cachedOwned());
  },
  /** Chapters V-XIII and the Epilogue (14) are locked until the journey is owned. */
  isChapterLocked(chapter: number): boolean {
    return chapter > FREE_LAST_CHAPTER && !this.owned;
  },
  buy(plan: Plan): void {
    bridge()?.buy(plan);
  },
  restore(): void {
    bridge()?.restore();
  },
  manage(): void {
    bridge()?.manageSubscription();
  },
};

/** Listens to the shell (call once at boot, after the native shell's hooks exist). */
export function installEntitlement(): void {
  const b = bridge();
  if (!b) return;
  const apply = (json: string): void => {
    const next = parse(json);
    if (!next) return;
    state = next;
    // Trust RevenueCat's answer only: an offline start keeps the remembered purchase.
    if (next.confirmed) remember(next.owned);
    events.emit('billing:changed', next);
  };
  const hooks = ((window as unknown as { __pilgrimNative?: Record<string, unknown> }).__pilgrimNative ??= {});
  hooks.billing = apply;
  try {
    apply(b.billingState());
  } catch {
    /* the shell is still starting; it pushes when ready */
  }
}
