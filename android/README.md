# Android shell (Kotlin WebView)

Wraps the built web game (`dist/`) in one full-screen WebView served from assets over
`https://appassets.androidplatform.net/` (secure origin: IndexedDB saves, Web Audio). Fully offline, no
permissions, no SDKs. Back button = the game's Pause.

- `./gradlew :app:bundleRelease` builds the web game (`npm run build` at the repo root), copies `dist/` into
  assets, and writes the signed AAB to `app/build/outputs/bundle/release/app-release.aab`
  (`:app:assembleRelease` for a signed APK). JDK: Android Studio's bundled JBR (set `JAVA_HOME`).
- Signing: `android/keystore.properties` + `android/release.jks` (both git-ignored). **Back the keystore up:
  Play requires every update to be signed with the same key.**
- Bump `versionCode` / `versionName` in `app/build.gradle.kts` for each store upload.
- Privacy policy (Play Console "Data safety" and store listing): https://pilgrim-narrow-way.netlify.app
