# Changelog

All notable changes to PILGRIM: THE NARROW WAY. Dates are release dates.

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
