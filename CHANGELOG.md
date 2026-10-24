# Changelog

All notable changes to PILGRIM: THE NARROW WAY. Dates are release dates.

## 0.2.0 — 2026-10-24 — A richer journey (versionCode 11)

- Premium look: frosted-glass menus, glossy buttons with icons, glass-orb game buttons.
- Every land's picture is a 3D scene drawn by the game; glossy chapter cards with a light sweep.
- 12 languages: English, Tamil, Hindi, Telugu, Malayalam, Kannada, Spanish, French, Portuguese, German, Indonesian, Russian.
- Settings reorganised (General, Sound, Controls, Advanced, About); rate, share, more games, update notice.

## 0.1.9 — 2026-10-24 — Follow the Way (versionCode 10)

- Hold your thumb on the screen and Christian walks the Way by himself; drag to explore.
- Music stays smooth through every mood change, and every song is prepared in the background.
- Cooler phones: 30 fps by default on phones, and the game eases off when the phone gets warm.

## 0.1.8 — 2026-10-24 — Smooth on phones (versionCode 9)

- Music plays smoothly on budget phones: each tune is prepared once on the device, then plays as a smooth loop.
- Gentler touch control: a light push walks, the run needs a firm push; dragging most of the screen walks instead of turning the camera.
- A real walking pace with the Burden, and calmer turns and camera.
- Tap the hand bubble over an object to use it; the tip line reads at the top of the screen.
- Haptics, pausing for phone calls, and full-screen under the camera notch.

## 0.1.7 — 2026-10-24 — Room to play (versionCode 8)

- Play shows only the controls: the objective and tips stay long enough for slow readers, then fade.
- A small map button opens a big map; close it to shrink it back.
- Menus, title and Settings fit small phones; Tamil text no longer overflows banners, toasts or buttons.

## 0.1.6 — 2026-10-24 — Small phones (versionCode 7)

- Narrow phones (360-420 px wide, e.g. 720p Android): a smaller objective banner, route map and journey line that keep the middle of the screen clear; the idle joystick ghost no longer sits under USE.

## 0.1.5 — 2026-10-23 — Curious pilgrims (versionCode 6)

- Chapter V: the Interpreter's six rooms are toy-puzzles, and your name can be written on the Roll.
- Chapter XI: the storm, shelter, sleep and Giant Despair carrying the pilgrims off.
- Chapter XII: five runaway lambs to bring home, the looking glass with a glimpse of the Celestial Gate, and the Enchanted Ground's sleepy meter.
- Badges with medal cards (15 in all), Promise nudges, a land recap on the loading screen and finds on CHAPTERS.
- Every chapter's road walkable end to end; Chapter X's missing beats; phone fixes (lighter scatter, readable toasts).

## 0.1.4 — 2026-10-15 — Spoken journey (versionCode 5)

- Offline spoken dialogue, story narration and optional objective guidance, with persistent voice settings.
- Native Android speech support and English/Tamil offline voice selection with classic dialogue fallback.

## 0.1.3 — 2026-10-15 — Follow, explore and resume (versionCode 4)

- Higher follow camera, automatic recentering on every device, and subtle cinematic travel and turn motion.
- North-up minimap with current position, facing, movement, route, checkpoints and goal; corrected navigation arrows.
- Remembered Slow, Normal and Fast movement settings, with Normal as the gentler default.
- Safe-position autosaves every five seconds and on pause/exit, a synchronous storage backup, and chapter state restoration for Continue.
- Fastlane build and Google Play release lanes; release credentials remain outside the repository.

### Offline spoken voices

- Added installed device speech for character dialogue, story captions, opening narration, and optional objective announcements. English and Tamil select only offline voices, with classic character sounds as the dialogue fallback.
- Added persistent Spoken / Classic / Off voice settings and a spoken-objectives toggle. Voices respect volume, skip, pause, language changes and backgrounding; dialogue takes priority over ambient chatter.
- Android uses its native offline TTS engine; no audio downloads or network permission. Voice quality and language availability depend on installed device voices.
- Verified the web build, voice/navigation regressions and Android debug compilation. Listening and voice availability still need verification on physical devices.

## 0.1.2 — 2026-10-15 — Guided journey (versionCode 3)

- Persistent objectives, always-visible route guidance, contextual control coaching, and a discoverable mobile joystick.
- Journey points for Promises, friends, checkpoints, and chapter completion, with saved duplicate prevention and animated rewards.
- Correct behind-camera arrow direction, aspect-ratio-aware angles, improved contrast, and HUD-safe placement.
- Adaptive rendering resolution for mobile Auto quality and reduced-motion support for guide and reward animations.
- English and Tamil guidance; checkpoint saves include discovery rewards.
- Browser regression coverage for rewards, objectives, mobile controls, and arrow direction.

## 0.1.1 — 2026-10-14 — Guide (versionCode 2)

- **Guide.** The HUD now points to the next goal: a bobbing golden chevron over it when on screen, an arrow on the screen edge when not. Chapters aim it at the Book, Christiana, the town gate, Evangelist, Help, Mr. Worldly Wiseman and the Wicket Gate; otherwise it points along the Way and stays quiet while you are moving on it. Detours are never pointed at.
- Play Store release guide (`release/PLAY-STORE-GUIDE.md`); `.aab` / `.apk` build artifacts are git-ignored.

## 0.1.0 — 2026-10-14 — Free demo (Chapters I–IV), first Android submission

### The game
- **Chapter I – The City of Destruction.** Christian wakes at home, reads the Book, the Burden grows, the family worries, the town shrugs. Evangelist points to the far light; Obstinate and Pliable give chase.
- **Chapter II – The Slough of Despond.** Sinking mud, hidden stepping stones that glow when you stand still, Pliable loses a boot and quits, Help reaches down a hand.
- **Chapter III – The Wrong Hill.** Mr. Worldly Wiseman's sunny road, the leaning mountain that rumbles and flashes, the Burden grows, Evangelist leads you back to the Way.
- **Chapter IV – The Wicket Gate.** Arrow volleys from the gloomy castle, cover rocks, "[E] Knock", Goodwill pulls you inside.
- Hope lantern, bonks (no deaths), waystones with autosave, collectible Promises, the Satchel (Roll, Promises, Friends met, Map, Carried), pause and settings menus.
- Keyboard + mouse, gamepad and touch controls; English and Tamil; text size and reduce-motion options; subtitles always on.

### Look and feel
- UI juice pack: sparkle bursts and soft edge vignettes on Promises, gifts, waystones and bonks; button squash and glint; staggered menu, dialogue and Satchel entrances; floating light motes and a drifting painted backdrop on the title screen.
- Painted attraction art (`public/art`): title backdrop, hero key art behind menus, chapter cards I–IV on the chapter select, loading screen and chapter title cards, and the new app icon.

### Android
- Kotlin WebView shell (`android/`): the whole game bundled in the app, served from a secure origin so saves and audio work, fully offline, zero permissions, no SDKs. Back button opens Pause.
- Signed release bundle 0.1.0 (versionCode 1), minSdk 26, targetSdk 36. Submitted to Google Play (package `com.pilgrim.narrowway`), content rating ESRB Everyone / PEGI 3, target audience 6+.

### Web and tooling
- Privacy policy site: https://pilgrim-narrow-way.netlify.app
- The asset check keeps `src/` and `content/` asset-free; `public/art/` is the one audited folder for shipped images (see docs/DECISIONS.md).

### Known limits
- Chapters V–XIII and the epilogue are not in this build; the demo ends at the Wicket Gate.
- The store listing has two phone screenshots and no tablet screenshots yet.

### Play Store release note (what players see)
First release: the free demo with Chapters I to IV (The City of Destruction, The Slough of Despond, The Wrong Hill, The Wicket Gate). Plays fully offline. No ads, no purchases, no data collection.
