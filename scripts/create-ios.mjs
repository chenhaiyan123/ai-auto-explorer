import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
// Capacitor 7.6.8 lowercases the SPM CLI option before comparing it to "SPM".
// Use its own generator with the resolved package manager, without modifying node_modules.
const { loadConfig } = require('@capacitor/cli/dist/config.js');
const { addCommand } = require('@capacitor/cli/dist/tasks/add.js');
const config = await loadConfig();
config.ios.packageManager = Promise.resolve('SPM');
config.cli.assets.ios.platformTemplateArchive = 'ios-spm-template.tar.gz';
config.cli.assets.ios.platformTemplateArchiveAbs = join(config.cli.assetsDirAbs, 'ios-spm-template.tar.gz');
await addCommand(config, 'ios');
