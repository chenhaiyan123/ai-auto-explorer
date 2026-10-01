import type { CapacitorConfig } from '@capacitor/cli';

// Local bundled UI; research runs on the existing cloud worker, never on an iOS background loop.
const iosBuild = process.env.HIEXPLORE_IOS_BUILD === '1';
const config: CapacitorConfig = {
  appId: 'com.hiexplore.app',
  appName: iosBuild ? 'HiExplore' : 'HiExplore 现实反馈',
  webDir: iosBuild ? 'dist-ios' : 'dist',
  server: { androidScheme: 'https', cleartext: !iosBuild },
  android: { adjustMarginsForEdgeToEdge: 'auto' },
  ios: { contentInset: 'never', backgroundColor: '#020617' },
  plugins: {
    // HTTPS APIs use the native transport, without changing website CORS policy.
    CapacitorHttp: { enabled: iosBuild },
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#020617', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#020617' },
  },
};
export default config;
