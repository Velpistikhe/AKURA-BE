import { Request } from 'express';

export const getAccessToken = (req: Request): string | undefined => {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return req.cookies?.accessToken;
};
