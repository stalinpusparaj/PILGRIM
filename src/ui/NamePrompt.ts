/**
 * "Give your name to the scribe" (GDD 2.10 Ch V room 5): a small cream card with one text field. The name is kept
 * in the save (`GameState.playerName`) and comes back written on the Roll (MY SATCHEL > THE ROLL) and at the
 * Celestial Gate. It stays on this device only. Enter writes it, Escape or "Not now" leaves the page blank.
 *
 * While the card is up gameplay input is off (typing into the field is never read as a game key: Input ignores
 * form fields), and it comes back when the card closes.
 */
import './name-prompt.css';
import { services } from '../core/Services';
import { t } from '../core/I18n';
import { h, uiRoot } from './dom';

export const NAME_MAX = 16;

/** Letters, marks, digits, spaces, hyphens and apostrophes only; trimmed and capped. */
export function cleanName(raw: string): string {
  return Array.from(raw.replace(/[^\p{L}\p{M}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim())
    .slice(0, NAME_MAX)
    .join('')
    .trim();
}

/** Shows the card; resolves with the cleaned name, or '' when the player chose not to give one. */
export function askName(initial = '', parent: HTMLElement = uiRoot()): Promise<string> {
  const input = services.tryGet('input');
  input?.releasePointerLock();
  input?.setGameplayActive(false);
  return new Promise((resolve) => {
    const field = h('input', {
      className: 'pg-name__field',
      type: 'text',
      value: initial,
      maxLength: NAME_MAX * 2,
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': t('ch05.name.label'),
    });
    const ok = h('button', { className: 'pg-name__btn pg-name__btn--ok', type: 'button' }, t('ch05.name.write'));
    const no = h('button', { className: 'pg-name__btn', type: 'button' }, t('ch05.name.skip'));
    const card = h(
      'form',
      { className: 'pg-name__card', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('ch05.name.title') },
      h('h2', { className: 'pg-name__title' }, t('ch05.name.title')),
      h('p', { className: 'pg-name__line' }, t('ch05.name.line')),
      field,
      h('div', { className: 'pg-name__row' }, no, ok),
    );
    const root = h('div', { className: 'pg-name' }, card);
    const finish = (name: string): void => {
      root.remove();
      input?.setGameplayActive(true);
      resolve(name);
    };
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(cleanName(field.value));
    });
    ok.addEventListener('click', () => finish(cleanName(field.value)));
    no.addEventListener('click', () => finish(''));
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish('');
    });
    parent.append(root);
    field.focus();
    field.select();
  });
}
