import type { CapacitorConfig } from '@capacitor/cli';

/*
 * SAI ROOM mobile shell (Android / iOS).
 *
 * The app loads the SAME web front-end the server already serves, from SAI_APP_URL, so the existing
 * same-origin cookie session, CSRF checks and screens keep working unchanged. The only native addition
 * is the `SaiBeacon` plugin that reads the club-room beacon (see docs/BEACON.md).
 *
 * SAI_APP_URL is read when you run `npx cap sync` and baked into the native projects:
 *   production : SAI_APP_URL=https://<your-domain> npx cap sync
 *   phone test : SAI_APP_URL=http://<your-PC-LAN-IP>:5317 npx cap sync   (server needs SAI_PUBLIC_ORIGIN set to the same URL)
 *
 * Capacitor documents `server.url` as intended for live-reload rather than production. It is used here
 * deliberately to avoid rewriting authentication; see docs/BEACON.md "배포 방식" for the trade-off.
 */
const url = process.env.SAI_APP_URL;
if (!url || !/^https?:\/\/[^/]+$/.test(url)) {
  throw new Error('Set SAI_APP_URL to the server origin (no path), e.g. SAI_APP_URL=https://sai.example.org npx cap sync');
}
const cleartext = url.startsWith('http://');

const config: CapacitorConfig = {
  appId: process.env.SAI_APP_ID || 'kr.ac.sejong.sai.room',
  appName: 'SAI ROOM',
  webDir: 'mobile/www',          // offline fallback page only; the real UI comes from SAI_APP_URL
  server: { url, cleartext },    // cleartext (http) is only for testing on a local network
  android: { allowMixedContent: false },
};

export default config;
