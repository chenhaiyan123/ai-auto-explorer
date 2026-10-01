import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
// iOS releases must never read .env.local or embed developer proxy/admin keys.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_')));
Object.assign(env, {
  HIEXPLORE_IOS_BUILD: '1',
  VITE_AUTH_API: 'https://hiexplore-auth-dlhnoibfcl.cn-hangzhou.fcapp.run',
  VITE_WAKE_API: 'https://pay.hiexplore.com',
  VITE_BILLING_API: 'https://pay.hiexplore.com',
});
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run('node_modules/.bin/tsc', []);
run('node_modules/.bin/vite', ['build', '--mode', 'ios']);
if (!existsSync('ios/App/App.xcodeproj')) run(process.execPath, ['scripts/create-ios.mjs']);
run('node_modules/.bin/cap', ['sync', 'ios']);
console.log('iOS project ready: ios/App/App.xcodeproj. Building/signing requires Xcode.');
