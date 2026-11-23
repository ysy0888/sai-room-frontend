# SAI ROOM mobile

Flutter 3.44.6 / Dart 3.12.2. Android 8+ (API 26), iOS 15+. App ID: `kr.ac.sejong.sai.room`, version 2.0.0 (20).

Login, approval, settings, reservations, weekly timetable, community, inquiries and account controls are Flutter widgets. The home chamber is the existing Three.js/soft-physics renderer bundled as a **local** WebView visual component. It loads no remote website, receives no session cookie and cannot navigate to external pages. This preserves the existing 3D art and incremental ball animation. Font, logo, scripts and styles are included in the binary.

The default API is `https://sai-room.vercel.app`. Debug builds may use `--dart-define=SAI_API_ORIGIN=http://127.0.0.1:5320` (iOS simulator) or `http://10.0.2.2:5320` (Android emulator). Release rejects HTTP. Native beacon networking intentionally accepts only the production SAI host; changing that host requires reviewing both platform adapters.

## Run and verify

```sh
npm ci && npm run build
python3 scripts/mobile-scene.py
cd mobile_flutter
flutter pub get
flutter analyze
flutter test
flutter run
```

Simulator quality gate (fixtures exist only in this test target, never the release entry point):

```sh
flutter drive --driver=test_driver/quality_driver.dart --target=integration_test/quality_test.dart -d DEVICE_ID
```

Screenshots are saved to `../artifacts/mobile`. Inspect login, 0/7/15-person chamber, weekly timetable and settings before merging UI changes. `python3 scripts/mobile-scene.py --check` confirms visual renderer parity. The `Mobile build validation` GitHub workflow is manually triggered; it builds unsigned packages, never publishes to a store.

## Release builds

```sh
flutter build appbundle --release
flutter build ios --release --no-codesign
```

Without `android/key.properties`, the AAB is intentionally unsigned (no debug signing fallback). For Google Play, copy `android/key.properties.example` to the ignored `key.properties`, fill in the owner's upload key locally, then rebuild. For TestFlight, open `ios/Runner.xcworkspace`, select the owner's team and matching bundle ID, archive and distribute. Signing credentials are neither generated on the owner's behalf nor checked into Git.

## Native presence

See [release notes](../docs/MOBILE-RELEASE.md) and [beacon protocol](../docs/BEACON.md). A background region/scanning adapter runs without a Flutter isolate. Pairing requires approved membership, explicit consent and system permissions. Server configuration remains disabled until the installed iBeacon UUID/major/minor is known. Simulator screenshots do not prove radio/background reliability; test physical devices at the room boundary before enabling the service.
