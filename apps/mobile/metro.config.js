const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Monorepo wiring: Metro must watch the repo root so changes in
 * packages/shared trigger a rebuild, and must resolve hoisted dependencies
 * from the root node_modules as well as the app's own.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
