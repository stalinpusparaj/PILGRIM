/**
 * FRIENDS MET page (GDD 2.14, 2.8): a character card for everyone met (state.friendsMet()), in story order, each
 * with a portrait, the name and one simple line ("Pliable: says yes to everything, gives up fast.").
 * Grumpy characters are listed too, with gentle, honest lines; Apollyon has no card (content/friends.json).
 *
 * Portraits come from `src/ui/Portraits.ts` (`Portraits.get(recipeId, expression?) → Promise<data URL>`), loaded
 * lazily and only if that module exists; until a portrait arrives, or if it fails, the card shows a round badge
 * in the character's colour with the first letter of the name.
 */
import { t } from '../core/I18n';
import { h } from './dom';
import { friendsFromMet, type FriendDef } from './satchel-data';
import { emptyNote, initialOf, type PageResult, type SatchelView } from './satchel-view';

export function renderFriends(view: SatchelView): PageResult {
  const friends = friendsFromMet(view.state.friendsMet());
  if (friends.length === 0) return { el: emptyNote(t('ui.satchel.friends.empty'), 'friends:empty') };
  const list = h('ul', { className: 'pg-satchel__grid pg-satchel__friends', role: 'list' });
  for (const f of friends) list.append(friendCard(view, f));
  return { el: list };
}

function friendCard(view: SatchelView, f: FriendDef): HTMLLIElement {
  const name = t(f.name);
  const line = t(f.line);
  const face = badge(f, name);
  const card = h(
    'li',
    { className: 'pg-satchel__card pg-satchel__friend', tabIndex: 0, dataset: { key: `friend:${f.id}` } },
    face,
    h(
      'div',
      { className: 'pg-satchel__friendText' },
      h('h3', { className: 'pg-satchel__friendName' }, name),
      h('p', { className: 'pg-satchel__friendLine' }, line),
    ),
  );
  void view.portrait(f.recipe, f.expr).then((url) => {
    if (!url || !view.alive() || !face.isConnected) return;
    const img = h('img', { className: 'pg-satchel__portrait', alt: '', src: url, draggable: false });
    img.addEventListener('error', () => img.replaceWith(badge(f, name)), { once: true });
    face.replaceWith(img);
  });
  return card;
}

function badge(f: FriendDef, name: string): HTMLSpanElement {
  return h(
    'span',
    {
      className: 'pg-satchel__badge',
      'aria-hidden': 'true',
      style: { '--friend': f.color, color: inkFor(f.color) },
    },
    initialOf(name),
  );
}

/** Dark or light letter on the badge colour, whichever reads better (WCAG relative luminance). */
function inkFor(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return l > 0.36 ? '#3b2a1f' : '#fff8ea';
}
