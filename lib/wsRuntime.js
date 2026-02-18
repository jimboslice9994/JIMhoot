function loadWsModule() {
  try {
    return require('ws');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

module.exports = {
  loadWsModule,
};
