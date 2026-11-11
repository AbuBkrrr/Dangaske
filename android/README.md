# DanGida Android app

The Android app is the website packaged as a **Trusted Web Activity**: it installs from the Play Store,
opens full-screen with no browser bar, and receives the same push notifications. There is one codebase —
every change to the site appears in the app immediately, with no app update.

It needs the site to be live on HTTPS first.

## Build (on a computer with Node.js and Java 17)

1. Put your domain in `twa-manifest.json` (replace `YOUR-DOMAIN.com`; change `packageId` if you wish).
2. Install the packaging tool and generate the project:

```bash
npm install -g @bubblewrap/cli
```

```bash
bubblewrap init --manifest https://YOUR-DOMAIN.com/manifest.webmanifest
```

   Answer the prompts with the values from `twa-manifest.json`. Bubblewrap downloads the Android SDK and
   creates a signing key (`android.keystore`). **Back this key up and never commit it** — you need the same key for every update.

3. Build:

```bash
bubblewrap build
```

   This produces `app-release-bundle.aab` (for the Play Store) and `app-release-signed.apk` (to test on a phone).

## Link the app to the site

4. Get the key fingerprint:

```bash
bubblewrap fingerprint list
```

5. In the server's `.env` set `ANDROID_PACKAGE` (the package id) and `ANDROID_SHA256` (the fingerprint), then restart.
   Check that `https://YOUR-DOMAIN.com/.well-known/assetlinks.json` now shows them.
6. When you upload to Google Play with Play App Signing, Google re-signs the app. Copy the **App signing key** SHA-256
   from Play Console → Setup → App integrity and add it to `ANDROID_SHA256` as well (comma separated). Without it the
   app shows a browser bar.

## Publish

7. Create the app in Google Play Console, upload the `.aab`, and complete the store listing, privacy policy link
   (`/legal/privacy`) and the data-safety and financial-features declarations (the app handles payments and investment offers).
