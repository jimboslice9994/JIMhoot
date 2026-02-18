function parseBool(v, fallback = false) {
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function getServerFeatureFlags() {
  return {
    multiplayer: parseBool(process.env.FEATURE_MULTIPLAYER, true),
    analytics: parseBool(process.env.FEATURE_ANALYTICS, false),
    newScoring: parseBool(process.env.FEATURE_NEW_SCORING, true),
    auth: parseBool(process.env.FEATURE_AUTH, true),
  };
}

module.exports = { getServerFeatureFlags };
