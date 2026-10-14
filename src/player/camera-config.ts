/**
 * Follow camera tuning (GDD 2.5). Metres, radians and "per second" rates. The few values worth tuning live in
 * `CAMERA_TUNE` (mutable, the F1 panel has sliders for them); everything else is fixed.
 *
 * Framing: the camera sits 4.5 m behind the player's feet and 2.2 m above them (2.0 m burdened) and looks at a
 * point at chest height, so the view tips slightly down (toy-diorama feel). It orbits round a pivot at head
 * height, so turning the view keeps Christian's head where it is on screen.
 *
 * The Burden (GDD 2.7.1) is as tall as torso + head and sits right behind the head, so from straight behind it
 * hides the head completely at the GDD camera height. Burdened, the whole rig slides sideways (an over-the-
 * shoulder offset that keeps the camera looking straight along the player's heading, so camera-relative steering
 * never drifts): the head and shoulder peek out beside the sack, and the look point moves up so the sack sits
 * lower on screen and more of the path ahead shows. The offset grows with the sack (it gets bigger in Ch III)
 * and goes back to centre when the Burden falls.
 */

/** Live-tunable values (F1 > Camera). */
export const CAMERA_TUNE = {
  /** Sideways offset (m, to the camera's right) per unit of Burden size (capped at CAMERA.shoulderMax). */
  shoulder: 1.0,
  /** Look-at height above the feet when burdened (m). */
  lookBurdened: 1.4,
  /** Look-at height above the feet when free (m). */
  lookFree: 1.05,
};

export const CAMERA = {
  /** GDD 2.5: 4.5 m behind and 2.2 m above the feet; 0.2 m lower when burdened. */
  back: 4.5,
  height: 2.2,
  burdenDrop: 0.2,
  /** Largest burdened shoulder offset (m), for the grown sack of Ch III. */
  shoulderMax: 1.35,
  /** Narrow screens get a smaller offset so Christian stays near the middle, clear of the touch joystick:
   *  × clamp((aspect / shoulderAspect)², shoulderAspectMin, 1). A portrait phone (0.45) keeps ~0.08 m: there the
   *  sack is read from behind (GDD 2.7.1 "comic and readable from behind"); 4:3 keeps ~0.7 m. */
  shoulderAspect: 1.6,
  shoulderAspectMin: 0,
  /** Orbit centre / spring-arm origin above the feet (about Christian's head). */
  pivotHeight: 1.3,
  /** Total arm elevation limits (rad): a little below the pivot up to a high, map-like view. */
  pitchMin: -0.3,
  pitchMax: 0.9,

  /** Spring arm: probe radius kept clear of walls and ground, shortest arm, pull-in / ease-out. */
  probe: 0.3,
  minArm: 0.2,
  /** The camera may lag a pull-in by at most this much of the probe radius (so it never enters a wall). */
  pullSlack: 0.5,
  pullInRate: 22,
  easeOutRate: 2.0,
  /** Wait this long after a pull-in before easing back out (no pumping past tree trunks). */
  easeOutDelay: 0.4,
  /** Pulled in close (arm fraction from `liftFrom` down to `liftTo`), the camera rises up to `lift` m and its look
   *  point moves up to `ahead` m forward and the burdened shoulder offset shrinks by up to `closeShoulder`: it
   *  looks down past the head instead of into it, with Christian still in view (an upward ray keeps it under
   *  ceilings). `closeRate` smooths the close-up factor that feeds back into the shoulder. */
  lift: 0.7,
  ahead: 1.0,
  closeShoulder: 0.85,
  closeRate: 6,
  liftFrom: 0.75,
  liftTo: 0.25,
  /** Height kept above the ground under the camera. */
  floorClear: 0.35,

  /** Auto-camera: swings behind the heading while walking, after this long without manual look input. */
  auto: {
    idle: 1.5,
    yawRate: 1.0,
    pitchRate: 0.8,
    /** Below this speed (m/s) the camera stays put; full strength from fullSpeed. */
    minSpeed: 0.4,
    fullSpeed: 2.0,
    /** Heading difference (rad): full strength below `full`, none beyond `none` (walking at the camera). */
    full: Math.PI * 0.25,
    weak: Math.PI * 0.55,
    weakScale: 0.3,
    none: Math.PI * 0.83,
  },

  /** Vertical follow: stiff on the ground (step-ups, facets), loose in the air (hops do not yank the view). */
  lagGround: 10,
  lagAir: 2.8,
  maxLag: 1.1,

  /** Burdened slow sway (sideways, camera only). Off with Reduce camera motion. */
  sway: { amp: 0.1, speed: 0.75, fade: 1.5 },
  /** Heavy steps and landings: a soft vertical spring (not a shake). Off with Reduce camera motion. */
  thud: { k: 130, c: 15, step: 0.4, land: 0.1, landMin: 3.5, landMax: 0.6, maxDip: 0.12 },
  /** A little wider view when running free (degrees). Off with Reduce camera motion. */
  fovKick: { deg: 4, from: 3.8, to: 6, rate: 3 },

  /** Burden framing follows the sack size at this rate (the "boing" never reaches the camera). */
  burdenRate: 2.5,
  maxBurden: 1.6,
  /** A step longer than this (m) is a teleport: snap instead of sweeping across the map. */
  teleport: 3,
  /** Default resume() blend (s), the CameraRig contract. */
  resumeBlend: 0.6,
} as const;
