/**
 * app.json stays the source of truth; this only adds what depends on a file that is not in the repository.
 *
 * Phone alerts on Android go through Firebase Cloud Messaging. Without a `google-services.json` in the build the
 * phone cannot be given a push token at all, so registration fails and no alert ever arrives, however correct the
 * rest is. Put the file Firebase gives you at Mobile/google-services.json and the next build picks it up. Until
 * then the build is exactly what it was, instead of failing on a missing file.
 */
/* eslint-disable @typescript-eslint/no-var-requires */ // a config file Expo loads as CommonJS
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const file = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(file)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } };
};
