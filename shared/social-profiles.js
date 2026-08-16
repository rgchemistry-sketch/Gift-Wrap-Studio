const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
]);

const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const FACEBOOK_HANDLE = /^[A-Za-z0-9.]{1,50}$/;

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

const FACEBOOK_RESERVED_PATHS = new Set([
  'about',
  'ads',
  'business',
  'dialog',
  'events',
  'gaming',
  'groups',
  'help',
  'legal',
  'login',
  'marketplace',
  'pages',
  'photo',
  'policies',
  'privacy',
  'profile.php',
  'reel',
  'share',
  'sharer',
  'stories',
  'watch',
]);

export const INSTAGRAM_PROFILE_MESSAGE =
  'Enter an @handle or an HTTPS Instagram profile URL';
export const FACEBOOK_PROFILE_MESSAGE =
  'Enter an @handle or an HTTPS Facebook profile or page URL';

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

export const normalizeFacebookProfile = (input) => {
  const value = String(input || '').trim();
  if (!value) return blankProfile();

  const directHandle = handleFromValue(value, FACEBOOK_HANDLE);
  if (directHandle && !FACEBOOK_RESERVED_PATHS.has(directHandle)) {
    return {
      handle: directHandle,
      label: `@${directHandle}`,
      url: `https://www.facebook.com/${directHandle}/`,
    };
  }

  const url = parseProfileUrl(value, FACEBOOK_HOSTS);
  if (!url) return null;
  const segments = pathSegments(url);

  if (segments.length === 1 && segments[0].toLowerCase() === 'profile.php') {
    const id = url.searchParams.get('id') || '';
    if (!/^\d{3,30}$/.test(id)) return null;
    return {
      handle: '',
      label: 'Facebook profile',
      url: `https://www.facebook.com/profile.php?id=${id}`,
    };
  }

  if (segments.length !== 1) return null;
  const handle = segments[0].toLowerCase();
  if (!FACEBOOK_HANDLE.test(handle) || FACEBOOK_RESERVED_PATHS.has(handle)) return null;
  return {
    handle,
    label: `@${handle}`,
    url: `https://www.facebook.com/${handle}/`,
  };
};
