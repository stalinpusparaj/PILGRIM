# Pilgrim Play Store release

From the repository root:

```sh
fastlane android build
fastlane android status
fastlane android release
```

`build` creates the signed AAB from the current game source using the existing Android upload key. `status` reads production version codes. `release` builds and submits the AAB with version-specific release notes to production. To publish to internal testing, use `fastlane android release track:internal`.

## Credentials

The workflow uses the local `secrets/play-service-account.json`, or a credential path in `SUPPLY_JSON_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`. The entire `secrets/` directory is git-ignored. Never commit credential JSON, upload keys, or signing passwords.

The service account needs app access for `com.pilgrim.narrowway` and the Play Console permission **Release to production, exclude devices, and use Play App Signing** for production submission. Testing access alone is insufficient.

## Each upload

Increase `versionCode`/`versionName` in `android/app/build.gradle.kts`, synchronize package versions and `CHANGELOG.md`, and add `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` (under 500 characters). Never reuse a version code already accepted by Play.

Only the AAB and release notes are uploaded; existing listing text, graphics and screenshots are preserved. The lane requests review, but Google review, managed publishing and account restrictions determine availability.

## 0.1.3 submission status

Version 0.1.3 (code 4) builds successfully and the credential can read production. The bundle and release notes uploaded, but final submission was rejected with `The caller does not have permission`. A subsequent production query still returned version code 1. Correct the service account's production permissions before retrying; confirm version-code availability if Play reports a duplicate upload.

## 0.1.4 submission status

Version 0.1.4 (code 5), including offline spoken voices, was built and uploaded with release notes on 2026-10-15. Google Play rejected the final edit commit with `The caller does not have permission`; the production release did not complete. Grant this service account app-level production release access before retrying. The signed bundle is available locally; check version-code availability if Play reports a duplicate.
