import type { CapacitorConfig } from '@capacitor/cli';

// Local bundled UI; research runs on the existing cloud worker, never on an iOS background loop.
const config: CapacitorConfig = {
  appId: 'com.hiexplore.app',
  appName: 'HiExplore',
  webDir: process.env.HIEXPLORE_IOS_BUILD === '1' ? 'dist-ios' : 'dist',
  server: { androidScheme: 'https', cleartext: false },
  android: { adjustMarginsForEdgeToEdge: 'auto' },
  ios: { contentInset: 'never', backgroundColor: '#020617' },
  plugins: {
    // HTTPS APIs use the native transport, without changing website CORS policy.
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#020617', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#020617' },
  },
};
export default config;
