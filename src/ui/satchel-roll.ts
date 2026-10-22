/**
 * THE ROLL page (GDD 2.14, 2.7.4): goals now and before.
 *
 *  - The current goal sits on top in a gold "Now" card (whatever the Roll's state, so a child can always look
 *    up what to do after the HUD objective has faded).
 *  - Before the Cross there is no Roll: Evangelist's note is the only page (once Christian carries `note`).
 *  - With the Roll: every earlier goal from `state.objectiveHistory()`, newest chapter first, ticked as done,
 *    and the name given to the scribe in Chapter V, if any.
 *  - Roll lost at the arbour (Ch VII): "Oh no, the Roll is gone!" and a gentle hint instead of the pages.
 *  - Badges (src/game/badges.ts) at the bottom: earned ones with their line; locked ones as "???" with a teasing
 *    hint and the chapter they belong to, so there is always something to go back and try.
 */
import { i18n, t } from '../core/I18n';
import { BADGES } from '../game/badges';
import { h } from './dom';
import { uiIcon } from './satchel-icons';
import {
  chapterNumber,
  chapterTitle,
  emptyNote,
  sectionTitle,
  svgSpan,
  type PageResult,
  type SatchelView,
} from './satchel-view';

export function renderRoll(view: SatchelView): PageResult {
  const s = view.state;
  const page = h('div', { className: 'pg-satchel__roll' });
  const nowKey = s.objective && i18n.has(s.objective) ? s.objective : null;
  if (nowKey) page.append(nowCard(nowKey));

  if (s.rollLost) {
    page.append(
      h(
        'div',
        {
          className: 'pg-satchel__sheet pg-satchel__sheet--lost',
          tabIndex: 0,
          dataset: { key: 'roll:lost' },
        },
        h('p', { className: 'pg-satchel__sheetLead' }, t('ui.toast.rollGone')),
        h('p', null, t('ui.satchel.roll.lostHint')),
      ),
    );
    return { el: page };
  }

  if (s.hasRoll) {
    const goals = earlierGoals(view, nowKey);
    if (goals.length > 0) page.append(goalSheet(goals));
    else if (!nowKey) page.append(emptyNote(t('ui.satchel.roll.empty'), 'roll:empty'));
    const name = s.playerName.trim();
    if (name) page.append(h('p', { className: 'pg-satchel__rollName' }, t('ui.satchel.roll.name', { name })));
    page.append(badgeSheet(view));
    return { el: page };
  }

  if (s.has('note')) page.append(notePage());
  else if (!nowKey) page.append(emptyNote(t('ui.satchel.roll.empty'), 'roll:empty'));
  page.append(badgeSheet(view));
  return { el: page };
}

/** Evangelist's note: the only page before the Cross. */
export function notePage(): HTMLElement {
  return h(
    'article',
    {
      className: 'pg-satchel__sheet pg-satchel__note',
      tabIndex: 0,
      dataset: { key: 'roll:note' },
      'aria-label': t('ui.satchel.roll.noteTitle'),
    },
    h('h3', { className: 'pg-satchel__noteTitle' }, t('ui.satchel.roll.noteTitle')),
    h('p', { className: 'pg-satchel__noteQuote' }, t('ui.satchel.roll.noteQuote')),
    h('p', { className: 'pg-satchel__noteLine' }, t('ui.satchel.roll.note')),
  );
}

function nowCard(key: string): HTMLElement {
  return h(
    'div',
    { className: 'pg-satchel__now', tabIndex: 0, dataset: { key: 'roll:now' } },
    svgSpan('pg-satchel__nowIcon', uiIcon('star', '1.4em')),
    h(
      'div',
      { className: 'pg-satchel__nowText' },
      h('span', { className: 'pg-satchel__nowLabel' }, t('ui.satchel.roll.now')),
      h('span', { className: 'pg-satchel__nowGoal' }, t(key)),
    ),
  );
}

interface GoalGroup {
  chapter: number;
  keys: string[];
}

/** Earlier goals grouped by chapter, newest chapter first; goals keep their order inside a chapter. */
function earlierGoals(view: SatchelView, nowKey: string | null): GoalGroup[] {
  const groups = new Map<number, string[]>();
  for (const { key, chapter } of view.state.objectiveHistory()) {
    if (key === nowKey || !i18n.has(key)) continue;
    const list = groups.get(chapter);
    if (list) list.push(key);
    else groups.set(chapter, [key]);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([chapter, keys]) => ({ chapter, keys }));
}

function goalSheet(groups: GoalGroup[]): HTMLElement {
  const sheet = h('div', { className: 'pg-satchel__sheet' }, sectionTitle(t('ui.satchel.roll.before')));
  for (const g of groups) {
    const heading = [chapterNumber(g.chapter), chapterTitle(g.chapter)].filter(Boolean).join(' · ');
    if (heading) sheet.append(h('h4', { className: 'pg-satchel__chapter' }, heading));
    const list = h('ul', { className: 'pg-satchel__goals', role: 'list' });
    for (const key of g.keys) {
      list.append(
        h(
          'li',
          { className: 'pg-satchel__goal', tabIndex: 0, dataset: { key: `goal:${key}` } },
          svgSpan('pg-satchel__tick', uiIcon('tick', '1.1em')),
          h('span', { className: 'sr-only' }, `${t('ui.satchel.roll.done')}: `),
          h('span', null, t(key)),
        ),
      );
    }
    sheet.append(list);
  }
  return sheet;
}

/** Every badge: earned ones bright with their line, the rest as "???" with a hint. */
function badgeSheet(view: SatchelView): HTMLElement {
  const earned = new Set(view.state.data.achievements);
  const n = BADGES.filter((b) => earned.has(b.id)).length;
  const sheet = h(
    'div',
    { className: 'pg-satchel__sheet pg-satchel__awards' },
    sectionTitle(t('ui.satchel.badges.title'), h('span', { className: 'pg-satchel__awardCount' }, t('ui.satchel.badges.count', { n, total: BADGES.length }))),
  );
  const list = h('ul', { className: 'pg-satchel__awardList', role: 'list' });
  for (const b of BADGES) {
    const got = earned.has(b.id);
    const where = b.chapter > 0 ? t('ui.satchel.badges.chapter', { n: b.chapter }) : '';
    list.append(
      h(
        'li',
        { className: `pg-satchel__award${got ? '' : ' is-locked'}`, tabIndex: 0, dataset: { key: `badge:${b.id}` } },
        svgSpan('pg-satchel__awardIcon', uiIcon(got ? 'star' : 'locked', '1.3em')),
        h(
          'span',
          { className: 'pg-satchel__awardText' },
          h('span', { className: 'pg-satchel__awardName' }, got ? t(b.name) : t('ui.satchel.badges.locked')),
          h('span', { className: 'pg-satchel__awardLine' }, got ? t(b.line) : [t(b.hint), where].filter(Boolean).join(' · ')),
        ),
      ),
    );
  }
  sheet.append(list);
  return sheet;
}
