module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // WatermelonDB requires legacy decorators support
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // react-native-reanimated plugin must always be listed last
      'react-native-reanimated/plugin',
    ],
  };
};
