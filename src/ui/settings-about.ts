/**
 * Settings > About (DECISIONS #397): rate the game, share it, like it on Facebook, send feedback, the game's
 * creators, and the version. Anything that leaves the game goes behind a grown-up check first (ParentGate,
 * Google Play Families policy). On Android the shell opens the Play listing, the share sheet and the links
 * (src/core/NativeShell.ts); in a browser Rate and Share use the store URL build flag. Facebook and Feedback
 * show only once their links are set in the Android app (res/values/links.xml).
 */
import { version as GAME_VERSION } from '../../package.json';
import { buildFlags } from '../core/Flags';
import { t } from '../core/I18n';
import { nativeLinks, updateAvailable } from '../core/NativeShell';
import { entitlement } from '../core/Entitlement';
import { openPaywallOver as openPaywall } from './Paywall';
import { Credits } from './Credits';
import { askGrownUp } from './ParentGate';
import { uiRoot } from './dom';
import type { ActionSpec, NoteSpec, RowSpec } from './settings-rows';

function action(id: string, icon: ActionSpec['icon'], run: () => void, hint: string | null = null): ActionSpec {
  return { kind: 'action', id, icon, label: t(`ui.settings.about.${id}`), hint, run };
}

/** Behind the grown-up check: `go` runs only after a right answer. */
const gated = (go: () => void) => (): void => void askGrownUp().then((ok) => ok && go());

/** The credits over Settings; Escape / Backspace (and Android Back, which sends Escape) close only them. */
function openCredits(): void {
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    credits.dispose();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' && e.key !== 'Backspace') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const credits = new Credits(uiRoot(), { variant: 'menu', onDone: close });
  credits.root.classList.add('pg-credits--over');
  window.addEventListener('keydown', onKey, true);
}

export function aboutRows(): RowSpec[] {
  const native = nativeLinks();
  const store = buildFlags.STORE_URL;
  const rows: RowSpec[] = [];
  // The full journey (DECISIONS #402): unlock (the paywall), or manage a subscription; restore either way.
  if (entitlement.hasStore) {
    const own = entitlement.state;
    if (!entitlement.owned) rows.push(action('unlock', 'star', openPaywall));
    else if (own.kind === 'subscription') rows.push(action('manage', 'gear', () => entitlement.manage()));
    rows.push(action('restore', 'home', () => entitlement.restore()));
  }
  if (native?.canRate || store) {
    rows.push(
      action(
        'rate',
        'star',
        // Owner's choice: Rate opens the Play listing straight away (no grown-up check).
        () => (native ? native.rate() : window.open(store, '_blank', 'noopener')),
        t('ui.settings.about.rateHint'),
      ),
    );
  }
  const shareText = t('ui.settings.about.shareText');
  if (native || (store && typeof navigator.share === 'function')) {
    rows.push(
      action(
        'share',
        'share',
        gated(() => {
          if (native) native.share(shareText);
          else void navigator.share({ title: t('ui.title.gameName'), text: shareText, url: store }).catch(() => {});
        }),
      ),
    );
  }
  if (native && updateAvailable() !== null) {
    rows.unshift(action('update', 'star', gated(() => native.rate()), t('ui.update.text')));
  }
  if (native?.has('more')) rows.push(action('moreApps', 'pad', gated(() => native.open('more'))));
  if (native?.has('facebook')) rows.push(action('facebook', 'like', gated(() => native.open('facebook'))));
  if (native?.has('feedback')) rows.push(action('feedback', 'mail', gated(() => native.open('feedback'))));
  rows.push(action('creators', 'book', openCredits, t('ui.credits.bunyan')));
  const version: NoteSpec = {
    kind: 'note',
    id: 'version',
    label: t('ui.settings.about.version'),
    text: () => t('ui.title.version', { version: GAME_VERSION }),
  };
  rows.push(version);
  return rows;
}
