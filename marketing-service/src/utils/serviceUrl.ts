import { env } from '../config/env.js';

const validatePath = (path: string) => {
  if (!/^(auth|marketing|fieldservice)\//.test(path) || path.includes('..') || path.includes('://')) throw new Error('Unsupported service path');
};

export const serviceUrl = (path: string): string => {
  validatePath(path);
  return `${env.API_GATEWAY_URL}/api/v1/${path}`;
};

export const serviceHeaders = (path: string): Record<string, string> => {
  validatePath(path);
  return { 'x-service-name': 'marketing-service', 'x-service-secret': env.GATEWAY_SECRET };
};
