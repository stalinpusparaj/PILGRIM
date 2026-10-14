/**
 * A sample cutscene for checking the system by eye and in tests (dev only; nothing in the game imports it).
 * With the test world (`?chapter=test`) on screen, from the console or a Playwright page:
 *
 *   const { playSample } = await import('/src/narrative/cutscene-sample.ts');
 *   await playSample();   // 'done' | 'skipped'
 *
 * Pliable walks up to Evangelist on a curved path (the gait comes from the speed), the camera cranes down a
 * rail set relative to Evangelist, cuts to an over-the-shoulder, a close-up and a slow two-shot;
 * both speak (bubbles if the 'bubbles' service runs, else letterbox captions, with babble); a sparkle plays and
 * an essential event adds 5 Hope, which also happens when the scene is skipped.
 */
import { services } from '../core/Services';
import type { Character } from '../gen/CharacterFactory';
import type { World } from '../world/World';
import { CutscenePlayer, shots, type CutsceneDef, type CutsceneResult } from './Cutscene';

export const SAMPLE_ID = 'sample_light';

/** The sample for two actors named 'guide' and 'friend' (the friend walks up to the guide). */
export function sampleCutscene(guide: Character, friend: Character): CutsceneDef {
  return {
    id: SAMPLE_ID,
    camera: [
      // A slow crane down onto the guide while the friend walks up (a scene starting near the player would
      // begin its first rail at 'camera' to ease out of the gameplay view instead).
      {
        start: 0,
        end: 3.4,
        path: [
          { actor: 'guide', offset: [6.5, 3.6, 9.5], local: true },
          { actor: 'guide', offset: [3.2, 2.1, 5.2], local: true },
        ],
        look: [{ actor: 'guide', at: 'chest' }],
        fov: [50, 46],
      },
      { start: 3.4, end: 6.6, shot: () => shots.overShoulder(friend, guide) },
      { start: 6.6, end: 9.6, shot: () => shots.closeUp(friend) },
      { start: 9.6, end: 13, shot: () => shots.two(guide, friend, { duration: 3.4, push: 0.1 }) },
    ],
    actors: [
      {
        actor: 'friend',
        actions: [
          { at: 0, do: 'place', to: { actor: 'guide', offset: [-2.4, 0, 6.5], local: true } },
          { at: 0.1, do: 'expression', expression: 'surprised' },
          {
            at: 0.2,
            do: 'moveTo',
            path: [
              { actor: 'guide', offset: [-1.6, 0, 3.6], local: true },
              { actor: 'guide', offset: [0, 0, 1.7], local: true },
            ],
            speed: 1.8,
          },
          { at: 4.2, do: 'lookAt', target: { actor: 'guide', at: 'head' } },
          { at: 6.8, do: 'say', key: 'cutscene.sample.2', mood: 'excited' },
          { at: 6.8, do: 'expression', expression: 'happy' },
          { at: 8.6, do: 'play', anim: 'hop' },
          { at: 10.2, do: 'face', yaw: 0 },
        ],
      },
      {
        actor: 'guide',
        actions: [
          { at: 3.4, do: 'lookAt', target: { actor: 'friend', at: 'head' } },
          { at: 3.6, do: 'say', key: 'cutscene.sample.1' },
          { at: 3.6, do: 'overlay', anim: 'point' },
          { at: 6.2, do: 'overlay', anim: null },
          { at: 10.2, do: 'face', yaw: 0 },
        ],
      },
    ],
    events: [
      { at: 8.6, sfx: 'sparkle' },
      { at: 11, run: () => services.tryGet('state')?.addHope(5), essential: true },
    ],
  };
}

/** Plays the sample in the test world: Evangelist is the guide, Pliable the friend. */
export async function playSample(): Promise<CutsceneResult> {
  const engine = services.get('engine');
  const world = testWorld();
  if (!world) throw new Error('playSample: open ?chapter=test first');
  const guide = world.npcs.get('evangelist');
  const friend = world.npcs.get('pliable');
  if (!guide || !friend) throw new Error('playSample: the test level needs evangelist and pliable');
  const player = services.tryGet('cutscene') ?? new CutscenePlayer(engine);
  return player.play(sampleCutscene(guide, friend), { actors: { guide, friend }, ground: world.terrain });
}

function testWorld(): World | null {
  const handle = (window as Window & { __pilgrim?: { testWorld: { current: World | null } | null } })
    .__pilgrim;
  return handle?.testWorld?.current ?? null;
}
