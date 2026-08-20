export function routeScrollIntent({ previous, pathname, hash, navigationType }) {
  const currentPathname = String(pathname || '/');
  const currentHash = String(hash || '');
  const initial = !previous;
  const pathnameChanged = initial || previous.pathname !== currentPathname;
  const hashChanged = initial || previous.hash !== currentHash;

  if (currentHash && (pathnameChanged || hashChanged)) {
    return { type: 'hash', hash: currentHash.slice(1) };
  }

  if (!initial && (pathnameChanged || hashChanged) && navigationType !== 'POP') {
    return { type: 'top' };
  }

  return { type: 'preserve' };
}
