# Mobile release implementation · 2026-11-23

## Architecture and visual gate

The web app remains available on Vercel and uses the same Seoul FastAPI/PostgreSQL backend. `mobile_flutter` is a separate genuine Flutter client; the website is not replaced with Flutter web. Only the 3D chamber uses the original locally bundled renderer. Native Flutter screens cover authentication, role-aware membership/inquiries, booking edits and weekly/day schedules, community, personalization and account settings.

The visual gate checks the original logo/navy/crimson palette and Korean fonts, readable auth controls, seven weekdays, the real WebGL canvas and 0/7/15-person density states. Incremental stable member IDs keep balls already in the chamber when other members enter/leave. A simulator capture uses isolated fixture data and cannot write production records. Source parity is enforced by `scripts/mobile-scene.py --check`. Changes must not be merged if screen comparison shows a regression.

## Implemented release safeguards

- Passwords stay in form memory and never enter persistence/retry fingerprints. Session cookies are Keychain/Keystore-protected. Presence has a distinct, hashed server-side credential that cannot read community/member data.
- Public content requires server-recorded acceptance of the versioned community rules. A small configurable text filter rejects explicit threats/abuse; this is not comprehensive automated moderation. Reports go to the staff queue, hiding a target removes it from all members, and personal author blocking hides their content without exposing anonymous identity.
- Settings support account/data deletion with password confirmation and native connection revocation. The last admin transfers authority to an approved member first. Both approved and pending accounts can delete themselves. Authenticated web deletion is also available at `https://sai-room.vercel.app/#delete-account`.
- Public privacy/rules page: `https://sai-room.vercel.app/#privacy`. iOS PrivacyInfo.xcprivacy declares linked functional data, including approximate room presence, with no tracking or advertising. Plugin manifests are bundled separately. Review the generated Xcode privacy report and store questionnaires before submission.
- New SQL tables use the existing private schema, RLS and restricted runtime role. No mobile client holds DB credentials, a service-role key or the initial operator code.

## Background presence, precisely

**iOS:** Core Location iBeacon region monitoring is initialized by AppDelegate even when Flutter is not running. The user grants When In Use and then Always access; region/state callbacks submit fresh timestamped events using background URLSession. Events older than 90 seconds are not retried as fresh observations. A missed departure may retain presence until its 12-hour maximum lease. Core Location decides callback timing; no claim of continuous scanning or guaranteed immediate transitions is made.

**Android:** an explicit opt-in starts a native location foreground service with an ongoing notification and stop action. It filters the installed iBeacon, applies entry/silence hysteresis, and renews server presence only on fresh BLE advertisements. A 5-minute server lease prevents a killed/offline scanner from leaving someone present for 12 hours. A detected exit expires after the server's 120-second grace. Permission loss or scan failure stops the adapter instead of inventing an exit event. Reboot/package-update restoration is conditional on pairing and allowed background permissions.

Both platforms support local disconnect, server credential revocation and a five-minute manual-checkout override. Force-stop, disabled Bluetooth/location, denied permissions, device power policies and network failures can prevent or delay detection. Reopen/re-enable after a force-stop. No GPS coordinates or travel history are transmitted. Beacon presence is a convenience indicator, not proof of attendance.

## Required physical test before enabling automatic presence

1. Configure the actual iBeacon UUID/major/minor, leave SAI_BEACON_ENABLED false until ready.
2. Use an approved test account on a physical iPhone and Android phone; grant informed permission in Settings → 자동 입퇴실.
3. Confirm entry from outside, stay while screen locked, departure, reentry during exit grace, reboot, Bluetooth off, permission removal, no network and reconnection.
4. Confirm account logout/deletion/notification stop revoke credentials, and no other member changes.
5. Measure adjacent-room false positives and detection delay. Tune RSSI/hysteresis based on the installed device. Enable only after these checks, retaining manual entry/exit.

## Still needed for store publication

These are release operations, not missing frontend placeholders: owner Apple Developer / Play Console access, final bundle ID ownership, upload signing/provisioning, a reachable public support contact, store metadata/screenshots/age rating, privacy/Data Safety declarations and background-location justification. App review credentials should use a dedicated review account with suitable access, not a real member's password. No store submission or paid developer-account purchase has been made.

Automatic presence remains off in production until real beacon configuration and field testing. The app binary builds without signing credentials; unsigned build success is not a successful App Store/Play release.

## Validation evidence for this revision

- PostgreSQL 17 runtime-role integration suite: 34 passed, including cross-user inquiry access, account deletion, report/block moderation and beacon expiry.
- Web browser flows: 61 existing checks plus 7 release-safety checks (isolated database).
- JavaScript unit suite: 29 passed; TypeScript and production bundles built.
- Flutter analyzer: no issues. Flutter widget/transport tests: 3 passed.
- iOS 26.5 simulator integration: real local WebGL, 0/7/15 density states, login, week view and settings passed.
- Android release AAB and iOS unsigned device build succeeded. Signing and physical Bluetooth verification remain open.
- Seoul hosted DB: four new private tables have RLS, runtime access and no anon/authenticated access; Supabase security advisory check returned no findings.
