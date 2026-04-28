const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package exports resolution for youtubei.js which ships as ESM
config.resolver.unstable_enablePackageExports = true;

// Add mjs and cjs to source extensions so Metro can resolve ESM/CJS hybrid packages
const { sourceExts, assetExts } = config.resolver;
config.resolver.sourceExts = ['mjs', 'cjs', ...sourceExts];

// Remove mjs/cjs from assetExts if they accidentally ended up there
config.resolver.assetExts = assetExts.filter(
  (ext) => ext !== 'mjs' && ext !== 'cjs',
);

// Enable inline requires for faster startup — modules are only evaluated when first accessed
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      inlineRequires: true,
    },
  }),
};

module.exports = config;
