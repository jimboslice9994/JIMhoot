export function getRoute() {
  const hash = window.location.hash || '#/solo';
  const routePart = hash.split('?')[0];
  const parts = routePart.replace(/^#\/?/, '').split('/');
  return parts[0] || 'solo';
}

export function onRouteChange(cb) {
  window.addEventListener('hashchange', cb);
}
