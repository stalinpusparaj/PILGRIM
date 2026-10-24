/**
 * Chapter pictures (DECISIONS #396): every land's picture is a 3D diorama our own renderer draws
 * (src/gen/Diorama.ts), painted through the `--art` CSS variable (art.css) on the chapter tiles, the loading
 * screen and the chapter card. No image files.
 */
import './art.css';
import { chapterDiorama, chapterDioramaNow } from '../gen/Diorama';

/** Chapter number for a chapter id ('1'..'13', 'ch01', 'epilogue' = 14), or null. */
export function chapterNumber(chapter: number | string | null): number | null {
  if (chapter === null) return null;
  if (chapter === 'epilogue') return 14;
  const n = typeof chapter === 'number' ? chapter : Number(/^(?:ch)?0*(\d{1,2})$/.exec(chapter)?.[1] ?? NaN);
  return Number.isInteger(n) && n >= 1 && n <= 14 ? n : null;
}

/** Paints chapter `chapter`'s diorama on `el` (`--art`): at once when drawn, else as soon as it is. */
export function paintChapterArt(el: HTMLElement, chapter: number | string | null): void {
  const n = chapterNumber(chapter);
  el.dataset.art = n === null ? '' : String(n);
  const now = n === null ? null : chapterDioramaNow(n);
  if (now || n === null) {
    setArt(el, now);
    return;
  }
  setArt(el, null);
  void chapterDiorama(n).then((url) => {
    if (el.dataset.art === String(n)) setArt(el, url);
  });
}

function setArt(el: HTMLElement, url: string | null): void {
  if (url) el.style.setProperty('--art', `url(${url})`);
  else el.style.removeProperty('--art');
}
