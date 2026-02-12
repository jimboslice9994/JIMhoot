export function getRoute() {
  const hash = window.location.hash || '#/solo';
  const parts = hash.replace(/^#\/?/, '').split('/');
  return parts[0] || 'solo';
}

export function onRouteChange(cb) {
  window.addEventListener('hashchange', cb);
}
