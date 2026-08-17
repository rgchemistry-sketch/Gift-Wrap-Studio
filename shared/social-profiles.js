const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;

const INSTAGRAM_RESERVED_PATHS = new Set([
  'accounts',
  'about',
  'developer',
  'direct',
  'directory',
  'explore',
  'legal',
  'p',
  'privacy',
  'reel',
  'reels',
  'stories',
  'terms',
  'tv',
]);

export const INSTAGRAM_PROFILE_MESSAGE =
  'Enter an @handle or an HTTPS Instagram profile URL';

const blankProfile = () => ({ handle: '', label: '', url: '' });

const parseProfileUrl = (value, hosts) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || !hosts.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

const pathSegments = (url) => {
  try {
    return url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return [];
  }
};

const handleFromValue = (value, pattern) => {
  if (!value.startsWith('@')) return '';
  const handle = value.slice(1);
  return pattern.test(handle) ? handle.toLowerCase() : '';
};

export const normalizeInstagramProfile = (input) => {
  const value = String(input || '').trim();
  if (!value) return blankProfile();

  const directHandle = handleFromValue(value, INSTAGRAM_HANDLE);
  if (directHandle && !INSTAGRAM_RESERVED_PATHS.has(directHandle)) {
    return {
      handle: directHandle,
      label: `@${directHandle}`,
      url: `https://www.instagram.com/${directHandle}/`,
    };
  }

  const url = parseProfileUrl(value, INSTAGRAM_HOSTS);
  if (!url) return null;
  const segments = pathSegments(url);
  if (segments.length !== 1) return null;
  const handle = segments[0].toLowerCase();
  if (!INSTAGRAM_HANDLE.test(handle) || INSTAGRAM_RESERVED_PATHS.has(handle)) return null;
  return {
    handle,
    label: `@${handle}`,
    url: `https://www.instagram.com/${handle}/`,
  };
};
