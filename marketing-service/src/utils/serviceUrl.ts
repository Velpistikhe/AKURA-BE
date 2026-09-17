import { env } from '../config/env.js';

const targetFor = (path: string) => {
  const separator = path.indexOf('/');
  const name = path.slice(0, separator);
  if (separator < 1 || !['auth', 'marketing'].includes(name)) throw new Error('Unsupported service path');
  return {
    url: name === 'auth' ? env.AUTH_SERVICE_URL : env.MARKETING_SERVICE_URL,
    secret: name === 'auth' ? env.AUTH_SERVICE_GATEWAY_SECRET : env.MARKETING_SERVICE_GATEWAY_SECRET,
    path: path.slice(separator),
  };
};

// Outbound routing is independent of the local browser access setting.
export const serviceUrl = (path: string): string => {
  const target = targetFor(path);
  return target.url.replace(/\/$/, '') + target.path;
};

export const serviceHeaders = (path: string): Record<string, string> => {
  const target = targetFor(path);
  if (!target.secret) throw new Error('Missing destination service gateway secret');
  return { 'x-gateway-secret': target.secret };
};
