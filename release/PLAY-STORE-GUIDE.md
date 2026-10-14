# Releasing PILGRIM: THE NARROW WAY to Google Play

Step-by-step guide from a clean checkout to a live listing. The app is a Kotlin WebView shell
(`android/`) around the built web game (`dist/`). It is fully offline, has no permissions, no ads, no
in-app purchases, no accounts and collects no data, which keeps every Play Console form short.

What already exists in this repo:

| Item | Where |
| --- | --- |
| Android project (Gradle, signing wired to `keystore.properties`) | `android/` |
| Store copy (name, short / full description) | `release/store/listing.md` |
| App icon 512 x 512 | `release/store/icon-512.png` |
| Feature graphic 1024 x 500 | `release/store/feature-graphic.png` |
| Phone screenshots 1080 x 2400 | `release/store/shot-1-title.png`, `shot-2-chapter1.png` |
| Privacy policy + support page (Netlify, publishes `privacy/`) | https://pilgrim-narrow-way.netlify.app |
| Signed builds from the last run | `release/*.aab`, `release/*.apk` (git-ignored) |

---

## 0. One-time prerequisites

1. **Google Play Developer account** at https://play.google.com/console (one-time US$25 fee, identity
   verification can take a few days). Use an account you will keep for years: the app is tied to it.
2. **Android Studio** (for its bundled JDK and the SDK). Set `JAVA_HOME` to the JBR, e.g. on macOS
   `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
3. **Node 22.18+** and `npm ci` at the repo root.
4. **Upload keystore** `android/release.jks` + `android/keystore.properties` (both git-ignored). If they are
   missing, create them once:

   ```sh
   cd android
   keytool -genkeypair -v -keystore release.jks -alias pilgrim -keyalg RSA -keysize 2048 -validity 10000
   cat > keystore.properties <<EOF
   storeFile=release.jks
   storePassword=<password>
   keyAlias=pilgrim
   keyPassword=<password>
   EOF
   ```

   **Back `release.jks` and the passwords up somewhere outside this machine** (password manager + an offline
   copy). With Play App Signing (step 3) Google holds the *app signing* key and this is only the *upload* key,
   which can be reset, but losing it still costs a support ticket and days of delay.

---

## 1. Build the release bundle

Every store upload needs a higher `versionCode`.

1. Edit `android/app/build.gradle.kts`:
   ```kotlin
   versionCode = 2          // +1 every upload, never reused
   versionName = "0.1.1"    // what players see
   ```
   Keep `version` in `package.json` and `CHANGELOG.md` in step.
2. Build and sign:
   ```sh
   cd android
   ./gradlew :app:bundleRelease     # runs `npm run build`, copies dist/ into assets, signs
   ./gradlew :app:assembleRelease   # optional: APK for side-loading on a test phone
   ```
   Outputs:
   - `android/app/build/outputs/bundle/release/app-release.aab` (upload this)
   - `android/app/build/outputs/apk/release/app-release.apk` (testing only)
3. Smoke-test the APK on a real phone before uploading:
   ```sh
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```
   Check: title screen loads offline (airplane mode), audio plays after the first tap, touch controls work,
   Back button opens Pause, saving survives force-quit, Tamil switch works, rotation does not reset the game.
4. Copy the artifacts for the record (git-ignored):
   ```sh
   cp app/build/outputs/bundle/release/app-release.aab ../release/pilgrim-narrow-way-<version>.aab
   ```

---

## 2. Create the app in Play Console

Play Console > **Create app**

| Field | Value |
| --- | --- |
| App name | Pilgrim: The Narrow Way |
| Default language | English (United Kingdom) or English (US) |
| App or game | Game |
| Free or paid | Free (this cannot be changed to paid later) |
| Declarations | Tick the Developer Program Policies and US export laws boxes |

---

## 3. Set up the app (the "Set up your app" dashboard checklist)

Work through every item; the dashboard will not let you publish until all are green.

### 3.1 Privacy policy
`https://pilgrim-narrow-way.netlify.app`. Make sure the Netlify site is deployed from `main` and the page
loads without login.

### 3.2 App access
"All functionality is available without special access." (no logins, no gated content).

### 3.3 Ads
"No, my app does not contain ads."

### 3.4 Content rating (IARC questionnaire)
- Category: **Game**.
- Violence: "cartoon or fantasy violence, mild" (arrows at the wicket gate, a "bonk"; no blood, no deaths).
- Everything else (sexuality, language, controlled substances, gambling, user interaction, sharing
  location, purchases): **No**.
- Expected result: ESRB Everyone / PEGI 3 / USK 0.

### 3.5 Target audience and content
- Target age groups: **6-8, 9-12** (and 13-15 if you like; the listing says 6-12).
- Because an under-13 group is selected the app falls under the **Families policy**. Answer:
  - Appeal to children: yes, designed for children.
  - Ads SDKs: none. Third-party SDKs: none (only AndroidX WebKit / Activity / Core).
  - Does the app unknowingly appeal to children: n/a.
- Privacy policy: the same Netlify URL.

### 3.6 Data safety
- "Does your app collect or share any of the required user data types?" **No.**
- "Is all of the user data collected by your app encrypted in transit?" n/a (nothing leaves the device).
- "Do you provide a way for users to request that their data is deleted?" n/a.
Saves live in the device's IndexedDB only; the manifest requests no `INTERNET` permission.

### 3.7 Government apps / Financial features / Health
All **No**.

### 3.8 News apps
No.

### 3.9 Advertising ID
No, the app does not use the advertising ID.

### 3.10 App category and contact details
- Category: **Game > Adventure** (or Educational). Tags: Adventure, Story, Kids.
- Email: `stalinpusparaj47@gmail.com` (shown publicly). Website: the Netlify URL.

### 3.11 Store listing
Paste from `release/store/listing.md` and upload from `release/store/`:

| Asset | Requirement | File |
| --- | --- | --- |
| App icon | 512 x 512 PNG, < 1 MB | `icon-512.png` |
| Feature graphic | 1024 x 500 PNG/JPEG | `feature-graphic.png` |
| Phone screenshots | 2-8, 16:9 to 9:16, 320-3840 px | `shot-1-title.png`, `shot-2-chapter1.png` |
| 7" tablet screenshots | needed for tablet listing quality | take 1-2 at 1600 x 2560 or 2560 x 1600 |
| 10" tablet screenshots | same | take 1-2 at 2560 x 1600 |
| Promo video | optional YouTube link | - |

Two phone screenshots is the minimum; four to six (slough, wrong hill, wicket gate, map, Tamil) convert
better. To shoot more, run `npm run dev`, open Chrome device mode at 1080 x 2400, and screenshot.

Add the Tamil translation of the listing under **Manage translations** when ready.

---

## 4. Play App Signing

On the first upload Play Console asks about app signing. Choose **"Use Google-generated key"** (default).
Google creates and keeps the app signing key; `release.jks` becomes the upload key. Nothing else to do.

---

## 5. Testing tracks (required before production)

**Personal developer accounts created after November 2023 must run a closed test with at least 12
testers opted in for 14 continuous days before they can apply for production access.** Plan the calendar
around this.

1. **Internal testing** (instant, up to 100 testers): Testing > Internal testing > Create new release >
   upload the `.aab` > release notes > Review and roll out. Share the opt-in link with yourself and family;
   installs via Play within minutes. Use this for every build.
2. **Closed testing**: Testing > Closed testing > create an "Alpha" track > upload the same `.aab` > add an
   email list of 12+ testers (Gmail addresses) > roll out. Testers must open the opt-in link and install.
   Keep it live for 14 days and tick the "feedback" questions Play asks afterwards.
3. After 14 days the dashboard shows **Apply for production access**. Fill the short form (what you tested,
   what you changed). Approval usually takes a few days.
4. Optional **Open testing** for a public beta link.

Release notes field (per language, < 500 chars), first release example:

```
<en-GB>
First release: the free demo, Chapters I-IV.
Walk from the City of Destruction to the Wicket Gate. English and Tamil. Plays fully offline.
</en-GB>
```

---

## 6. Production release

1. Production > **Create new release** > pick the bundle already uploaded to testing ("Add from library")
   or upload a new one with a higher `versionCode`.
2. Release notes, then **Review release**. Fix any warnings (missing tablet screenshots are a warning, not
   a blocker).
3. **Countries / regions**: Add countries > select all (or India + your target markets first).
4. **Start rollout to Production**. The review for a new app typically takes 1-7 days; family-targeted
   apps are checked more carefully. You get an email when it is live or rejected (rejections state the
   policy; fix and resubmit from the same release).

---

## 7. After launch

- **Pre-launch report** (Testing > Pre-launch report) runs the app on real devices: check for crashes and
  WebView warnings.
- **Android vitals** for crash and ANR rates. A WebView game's usual culprit is memory on low-end phones;
  keep the GDD 2.15 budgets.
- **Reviews**: reply from Play Console; kids' apps get parent questions about safety, point them to the
  privacy page.
- **Each update**: bump `versionCode` + `versionName`, update `CHANGELOG.md`, build, internal test, then
  promote the same bundle to production. Never upload a bundle signed with a different key.
- **Target SDK deadline**: Play requires new updates to target a recent API level (currently 35+, raised
  every August). `targetSdk = 36` is fine for now; revisit each year.
- **Policy declarations** expire: the Data safety and Families forms must be re-confirmed when Google
  updates them (you get an email with a deadline).

---

## Quick checklist

- [ ] `versionCode` bumped, `versionName` and `CHANGELOG.md` updated
- [ ] `./gradlew :app:bundleRelease` green, AAB copied to `release/`
- [ ] APK smoke-tested on a phone in airplane mode
- [ ] Privacy page live at the Netlify URL
- [ ] Store listing text + icon + feature graphic + >= 2 phone screenshots
- [ ] Content rating, Target audience (Families), Data safety ("no data"), Ads ("none") all saved
- [ ] Internal test installs and plays
- [ ] Closed test: 12+ testers, 14 days (first release only)
- [ ] Production access granted, rollout started
- [ ] `release.jks` + passwords backed up off-machine
