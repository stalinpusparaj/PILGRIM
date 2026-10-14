/**
 * F1 panel controls for the flow (dev builds or ?debug=1; plain English is fine there).
 */
import type { Debug } from '../core/Debug';
import { events } from '../core/Events';
import type { GameFlow } from './GameFlow';

export function installFlowDebug(debug: Debug, flow: GameFlow): () => void {
  const g = 'Flow';
  const offs = [
    debug.addReadout(
      'Flow',
      () => `${flow.state} / ${flow.screen}${flow.chapter ? ` (ch ${flow.chapter})` : ''}`,
    ),
    debug.addButton(g, 'Title screen', () => flow.showTitle()),
    debug.addButton(g, 'New game', () => flow.newGame()),
    debug.addButton(g, 'Pause', () => flow.pause()),
    debug.addButton(g, 'Complete chapter', () => {
      const n = flow.chapter;
      if (n !== null) events.emit('chapter:complete', { chapter: n });
    }),
    debug.addButton(g, 'Demo end', () => flow.showDemoEnd()),
    debug.addButton(g, 'End card', () => flow.showEndCard()),
    debug.addButton(g, 'End credits', () => flow.showCredits('end')),
  ];
  return () => {
    for (const off of offs) off();
  };
}
