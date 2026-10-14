/**
 * The test chapter (`?chapter=test`, and the stand-in for chapters that have no script yet): the Phase 3
 * acceptance sample on content/levels/test.json.
 * - Pliable follows Christian as a companion (GDD 2.8).
 * - Evangelist has an [E] Talk: 'test_evangelist' (content/dialogue/test.json): three choices with different
 *   Hope effects, camera cuts, babble voices and moods, in English and Tamil. It can be replayed.
 * - The objective is "Follow the shining light".
 * - The trigger 'test_cross_near' (a circle round the cross) shows a toast naming the place.
 */
import { i18n } from '../core/I18n';
import type { ChapterScript } from './types';

/** A generic bark line: automatic barks wait until the companions' lines are in the string tables. */
const BARK_LINE = 'bark.generic.idle.1';

const script: ChapterScript = {
  id: 'test',
  level: 'test',
  start(ctx) {
    ctx.objective('ui.hud.objective.followLight');
    if (ctx.npc('pliable')) {
      const pliable = ctx.addCompanion('pliable');
      // Until content/i18n/fragments/npc.*.json is merged into en/ta.json the generic barks have no text.
      pliable.autoBarks = i18n.has(BARK_LINE);
    }
    ctx.onTalk('evangelist', 'test_evangelist');
    ctx.onTrigger('test_cross_near', () => ctx.toast('ui.chapter.6.title'));
  },
};

export default script;
