/**
 * CARRIED page (GDD 2.14, 2.7.6): item cards for `state.data.carried`, then the gifts.
 *  - roll: "The Roll" (greyed with "Oh no, the Roll is gone!" while lost at the arbour).
 *  - note: Evangelist's note.
 *  - key_promise: the card simply reads "A key called Promise." (GDD 2.14, exactly) and nothing else.
 *  - any other carried id with an `ui.satchel.item.<id>.name` key gets a plain card; unknown ids are skipped.
 * A "Use" button appears on a card only while `view.canUse(id)` says so (the chapter decides: the Key of
 * Promise at a locked door of Doubting Castle, GDD 2.10 Ch XI). Using closes the Satchel ('satchel:use').
 */
import { GIFT_IDS, type GiftId } from '../core/GameState';
import { i18n, t } from '../core/I18n';
import { h } from './dom';
import { itemIcon } from './satchel-icons';
import { emptyNote, sectionTitle, svgSpan, type PageResult, type SatchelView } from './satchel-view';

interface ItemCard {
  id: string;
  /** Visible heading; null for the Key (its card is one line only). */
  name: string | null;
  line: string;
  missing?: boolean;
}

export function renderCarried(view: SatchelView): PageResult {
  const s = view.state;
  const page = h('div', { className: 'pg-satchel__carried' });
  const items = s.data.carried.map((id) => itemCard(view, id)).filter((c): c is ItemCard => c !== null);
  const gifts = s.data.gifts.filter(
    (g): g is GiftId => g !== 'key_promise' && (GIFT_IDS as readonly string[]).includes(g),
  );
  if (items.length === 0 && gifts.length === 0) {
    page.append(emptyNote(t('ui.satchel.carried.empty'), 'carried:empty'));
    return { el: page };
  }
  if (items.length > 0) {
    const list = h('ul', { className: 'pg-satchel__grid pg-satchel__items', role: 'list' });
    for (const c of items) list.append(renderCard(view, c));
    page.append(sectionTitle(t('ui.satchel.carried.items')), list);
  }
  if (gifts.length > 0) {
    const list = h('ul', { className: 'pg-satchel__grid pg-satchel__items', role: 'list' });
    for (const g of gifts) list.append(renderCard(view, giftCard(g)));
    page.append(sectionTitle(t('ui.satchel.carried.gifts')), list);
  }
  return { el: page };
}

function itemCard(view: SatchelView, id: string): ItemCard | null {
  switch (id) {
    case 'roll':
      return view.state.rollLost
        ? { id, name: t('ui.satchel.item.roll.name'), line: t('ui.toast.rollGone'), missing: true }
        : { id, name: t('ui.satchel.item.roll.name'), line: t('ui.satchel.item.roll.line') };
    case 'note':
      return { id, name: t('ui.satchel.roll.noteTitle'), line: t('ui.satchel.roll.noteQuote') };
    case 'key_promise':
      return { id, name: null, line: t('ui.satchel.item.key_promise') };
    default: {
      const nameKey = `ui.satchel.item.${id}.name`;
      if (!i18n.has(nameKey)) return null;
      const lineKey = `ui.satchel.item.${id}.line`;
      return { id, name: t(nameKey), line: i18n.has(lineKey) ? t(lineKey) : '' };
    }
  }
}

function giftCard(id: GiftId): ItemCard {
  const lineKey = `ui.satchel.gift.${id}.line`;
  return { id, name: t(`ui.gift.${id}.name`), line: i18n.has(lineKey) ? t(lineKey) : '' };
}

function renderCard(view: SatchelView, c: ItemCard): HTMLLIElement {
  const label = c.name ? `${c.name}. ${c.line}` : c.line;
  const card = h(
    'li',
    {
      className: `pg-satchel__card pg-satchel__item${c.missing ? ' is-missing' : ''}${c.name ? '' : ' pg-satchel__item--lineOnly'}`,
      dataset: { key: `item:${c.id}` },
      'aria-label': label,
    },
    svgSpan('pg-satchel__itemIcon', itemIcon(c.id, '64')),
    h(
      'div',
      { className: 'pg-satchel__itemText' },
      c.name ? h('h4', { className: 'pg-satchel__itemName' }, c.name) : null,
      c.line ? h('p', { className: 'pg-satchel__itemLine' }, c.line) : null,
    ),
  );
  if (!c.missing && view.canUse(c.id)) {
    card.append(
      h(
        'button',
        {
          type: 'button',
          className: 'btn pg-satchel__action pg-satchel__use',
          dataset: { key: `use:${c.id}` },
          'aria-label': t('ui.satchel.useLabel', { item: c.name ?? c.line }),
          onClick: () => view.useItem(c.id),
        },
        t('ui.verb.use'),
      ),
    );
  } else {
    card.tabIndex = 0;
  }
  return card;
}
