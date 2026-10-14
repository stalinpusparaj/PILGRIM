/**
 * PROMISES page (GDD 2.14, 2.7.2, 2.7.5): all 24 slots in story order.
 *  - Collected: the line and its reference, and a "Read" button (+15 Hope once per Promise per chapter, through
 *    GameState.readPromise). After reading, or when already read this chapter: "Read already".
 *  - Not found yet: a soft dashed placeholder with a "?" and the chapter it hides in.
 * Reading sparkles the card (skipped with reduce motion) and plays 'promise_chime' (SatchelUI does the sound).
 */
import { t } from '../core/I18n';
import { h } from './dom';
import { PROMISES, type PromiseDef } from './satchel-data';
import { tabIcon, uiIcon } from './satchel-icons';
import { chapterNumber, reducedMotion, svgSpan, type PageResult, type SatchelView } from './satchel-view';

const SPARKLE_MS = 1100;
const SPARKS = 7;

export function renderPromises(view: SatchelView): PageResult {
  const list = h('ul', { className: 'pg-satchel__grid pg-satchel__promises', role: 'list' });
  for (const p of PROMISES) {
    list.append(view.state.hasPromise(p.id) ? collectedCard(view, p) : lockedCard(p));
  }
  return { el: list };
}

function lockedCard(p: PromiseDef): HTMLLIElement {
  const where = chapterNumber(p.chapter);
  return h(
    'li',
    {
      className: 'pg-satchel__card pg-satchel__promise is-locked',
      tabIndex: 0,
      dataset: { key: `promise:${p.id}` },
      'aria-label': [t('ui.satchel.promise.locked'), where].filter(Boolean).join('. '),
    },
    h('span', { className: 'pg-satchel__lockedMark', 'aria-hidden': 'true' }, '?'),
    h('span', { className: 'pg-satchel__lockedWhere', 'aria-hidden': 'true' }, where),
  );
}

function collectedCard(view: SatchelView, p: PromiseDef): HTMLLIElement {
  const text = t(p.text);
  const ref = t(p.refKey);
  const card = h(
    'li',
    {
      className: 'pg-satchel__card pg-satchel__promise',
      dataset: { key: `promise:${p.id}` },
      'aria-label': `${text} ${ref}`,
    },
    svgSpan('pg-satchel__promiseIcon', tabIcon('promises', '1.5em')),
    h('p', { className: 'pg-satchel__promiseText' }, text),
    h('p', { className: 'pg-satchel__promiseRef' }, ref),
  );
  const foot = h('div', { className: 'pg-satchel__promiseFoot' });
  card.append(foot);
  if (view.state.readThisChapter(p.id)) {
    markRead(card, foot);
    return card;
  }
  const button = h(
    'button',
    {
      type: 'button',
      className: 'btn pg-satchel__action',
      dataset: { key: `read:${p.id}` },
      'aria-label': t('ui.satchel.promise.readLabel', { ref }),
      onClick: () => {
        if (!button.isConnected) return;
        const gained = view.readPromise(p.id);
        const hadFocus = document.activeElement === button;
        markRead(card, foot);
        if (hadFocus) card.focus();
        if (gained > 0) sparkle(card, view);
      },
    },
    t('ui.verb.read'),
  );
  foot.append(button);
  return card;
}

/** Swap the Read button for the "Read already" pill; the card itself becomes the focus stop. */
function markRead(card: HTMLLIElement, foot: HTMLElement): void {
  foot.replaceChildren(
    h(
      'span',
      { className: 'pg-satchel__pill' },
      svgSpan('pg-satchel__tick', uiIcon('tick', '1em')),
      t('ui.satchel.readAlready'),
    ),
  );
  card.tabIndex = 0;
  card.classList.add('is-read');
}

/** A soft burst of stars over the card, once (no flashing; nothing with reduce motion). */
function sparkle(card: HTMLElement, view: SatchelView): void {
  card.classList.add('is-glow');
  if (reducedMotion()) return;
  const layer = h('span', { className: 'pg-satchel__sparkles', 'aria-hidden': 'true' });
  for (let i = 0; i < SPARKS; i++) {
    const a = (i / SPARKS) * Math.PI * 2 + 0.4;
    const star = svgSpan('pg-satchel__spark', uiIcon('sparkle', '1em'));
    star.style.setProperty('--dx', `${Math.cos(a) * 46}px`);
    star.style.setProperty('--dy', `${Math.sin(a) * 34}px`);
    star.style.setProperty('--delay', `${(i % 3) * 70}ms`);
    layer.append(star);
  }
  card.append(layer);
  view.later(() => layer.remove(), SPARKLE_MS);
}
