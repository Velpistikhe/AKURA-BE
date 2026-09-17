export const isLocalOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
};
