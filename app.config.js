module.exports = ({ config }) => {
  const useGoogleMaps = process.env.EXPO_PUBLIC_USE_GOOGLE_MAPS === 'true';
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ...(useGoogleMaps && apiKey
        ? [[
            'react-native-maps',
            {
              androidGoogleMapsApiKey: apiKey,
              iosGoogleMapsApiKey: apiKey,
            },
          ]]
        : []),
    ],
  };
};