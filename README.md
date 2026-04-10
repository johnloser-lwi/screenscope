# ScreenScope

Real-time vectorscope and waveform monitor using screen capture. Built with Electron.

## Building from source

### Prerequisites

- Node.js 20+
- npm

```
npm install
```

### Development

Runs Vite dev server and Electron concurrently with hot reload:

```
npm run dev
```

### Production build

**macOS:**
```
npm run dist:mac
```
Output: `release/*.dmg`

**Windows:**
```
npm run dist:win
```
Output: `release/*.exe`

---

## macOS build notes

### Pre-built DMG from GitHub Releases

The DMG distributed via GitHub Actions is **not signed with an Apple Developer certificate** (requires a $99/yr Apple Developer account). macOS will show one of two warnings depending on how the app was obtained:

**"Apple cannot verify this app"** — appears when running a locally built app or one without the quarantine flag. Fix:

```
xattr -cr /Applications/ScreenScope.app
```

Or go to **System Settings → Privacy & Security** and click **Open Anyway**.

**"App is damaged and can't be opened"** — appears when macOS Gatekeeper quarantines a downloaded unsigned app. Fix:

```
xattr -cr ~/Downloads/ScreenScope.dmg
```

Then re-mount and install.

### Why not just sign it?

Distributing a properly signed and notarized macOS app requires:

1. An Apple Developer account ($99/yr)
2. A Developer ID Application certificate
3. Notarization via Apple's servers after each build

Without this, the built `.app` contains Electron's linker-embedded ad-hoc signature but no outer bundle signature — macOS treats this as a corrupt/broken signature rather than simply unsigned. The GitHub workflow works around this by re-signing the bundle with a local ad-hoc signature (`codesign --force --deep --sign -`) before packaging the DMG, which produces a consistently unsigned app that triggers the milder "cannot verify" warning instead of "app is damaged."

### Screen recording permission

On macOS, the app requires Screen Recording access. On first launch, a dialog will prompt you to open **System Settings → Privacy & Security → Screen Recording** and enable ScreenScope. The app must be relaunched after granting permission.
