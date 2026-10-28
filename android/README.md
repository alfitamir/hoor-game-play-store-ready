# Android release

This project uses a Trusted Web Activity (TWA) for the Android package. The APK must open the **same HTTPS origin that serves the verified production web build**. Do not ship the old APK from `public/`: it points at a different host and contains the previous wrapper configuration.

## Prerequisites

- A verified HTTPS production host serving this repository's `dist/client` output.
- A Google Play Console developer account and a unique application ID.
- Node.js 20+ and the Bubblewrap CLI.
- Android SDK, build-tools, and JDK 17 or 21.
- A new release keystore stored outside Git. Never commit the keystore or passwords.
- The SHA-256 certificate fingerprint for the certificate used by the installed APK. If Play App Signing is enabled, publish both the upload and app-signing fingerprints where appropriate.

## Build

1. Copy `twa-manifest.json` to a private build directory and replace every `REPLACE_WITH_VERIFIED_PRODUCTION_HOST` value with the one canonical HTTPS origin. The host must match the deployed app and `fullScopeUrl`.
2. Generate a release key outside the repository, for example:

   ```sh
   keytool -genkeypair -v -keystore release-keystore.jks \
     -alias hoor-release -keyalg RSA -keysize 4096 -validity 10000
   ```

3. Run Bubblewrap from the directory containing the completed manifest. Supply passwords through its interactive prompt or environment-specific secret storage; do not put them in JSON or shell history.

   ```sh
   npx @bubblewrap/cli init --manifest ./twa-manifest.json
   npx @bubblewrap/cli build
   ```

4. Test the generated **signed AAB** on an Android device. For Play Store distribution, upload the AAB rather than only an APK. Use the generated APK for local installation and smoke tests.

## Digital Asset Links

The production host must serve `/.well-known/assetlinks.json` over HTTPS. Start from `assetlinks.json.template`, replace the package name and SHA-256 fingerprint, then deploy it to the web host. The fingerprint is not the keystore password and is safe to publish. Verify the endpoint before release:

```sh
curl --fail --silent --show-error https://YOUR_HOST/.well-known/assetlinks.json
```

Without a correct asset-links file, Android will fall back to a Custom Tab and the result is not a fully verified TWA.

## Pre-upload checks

- Build from a clean checkout and confirm `npm run build` and `npm run verify:release` pass.
- Confirm no placeholder host, Google client ID, private key, Supabase secret key, or debug signing configuration is present.
- Test first launch, offline launch, audio, backup export/import, rotation policy, back navigation, data reset, and the Android system back button.
- Complete the Play Console Data safety form, target-SDK declaration, content rating, child-directed audience answers, privacy policy URL, app access instructions if needed, and store listing in Arabic and English.
- If the app is directed to children, follow Google Play Families policies and obtain legal/privacy review before submission. A local-only game still needs accurate disclosures about external fonts and recitation audio hosts.

This repository can prepare the code and repeatable build inputs, but the final signed Play Store artifact must be produced with the publisher's own keystore, verified domain, Play Console account, privacy policy, and release review.
