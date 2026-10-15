import * as THREE from 'three';
import type { SaveData } from '../core/Save';
import type { PlaySession } from './PlaySession';

const PREFIX = 'resume.';
/** Metadata only lives in the saved copy, so ordinary checkpoint/death respawns stay independent. */
export function captureResume(session: PlaySession, talking: boolean): SaveData | null {
  const { player, state } = session;
  if (
    session.isDisposed ||
    talking ||
    player.mode !== 'play' ||
    !player.isGrounded ||
    state.hope <= 0 ||
    session.slough.sinking
  )
    return null;
  if (state.chapter === 1 && state.flag('ch01.stage') === 'done') return null;
  if (state.chapter === 1 && state.flag('ch01.stage') === 'way' && !state.flag('ch01.pliableJoins'))
    return null;
  if (state.chapter === 3 && state.flag('ch03.phase') === 'evangelist') return null;
  const p = player.controller.position;
  if (![p.x, p.y, p.z].every(Number.isFinite)) return null;
  const data = state.snapshot();
  data.flags[`${PREFIX}level`] = session.levelId;
  data.flags[`${PREFIX}chapter`] = state.chapter;
  data.flags[`${PREFIX}x`] = p.x;
  data.flags[`${PREFIX}y`] = p.y;
  data.flags[`${PREFIX}z`] = p.z;
  data.flags[`${PREFIX}facing`] = Math.atan2(player.forward.x, player.forward.z);
  return data;
}

export function restoreResume(session: PlaySession): boolean {
  const { state } = session;
  if (state.flag('resume.level') !== session.levelId || state.flag('resume.chapter') !== state.chapter)
    return false;
  const x = state.flag('resume.x'),
    y = state.flag('resume.y'),
    z = state.flag('resume.z'),
    facing = state.flag('resume.facing');
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    typeof facing !== 'number' ||
    ![x, y, z, facing].every(Number.isFinite)
  )
    return false;
  const limit = session.world.level.size / 2 + 20;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return false;
  const ground = session.col.groundAt(x, z, y + 0.3);
  if (!Number.isFinite(ground) || Math.abs(ground - y) > 0.8) return false;
  session.player.teleport(new THREE.Vector3(x, ground, z), facing);
  session.camera.snap();
  return true;
}

export function clearResume(session: PlaySession): void {
  for (const key of Object.keys(session.state.data.flags))
    if (key.startsWith(PREFIX)) session.state.setFlag(key, undefined);
}
