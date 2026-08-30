import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env.js';

const loadPrivateKey = (): KeyObject => {
  const source = env.JWT_ACCESS_PRIVATE_KEY_BASE64
    ? Buffer.from(env.JWT_ACCESS_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
    : readFileSync(resolve(env.JWT_ACCESS_PRIVATE_KEY_PATH as string), 'utf8');
  const key = createPrivateKey(source);
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error('JWT access private key must be an RSA key');
  }
  const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (modulusLength < 2048) {
    throw new Error('JWT access private key must use at least 2048 bits');
  }
  return key;
};

export const accessTokenPrivateKey = loadPrivateKey();
export const accessTokenPublicKey = createPublicKey(accessTokenPrivateKey);

const publicJwk = accessTokenPublicKey.export({ format: 'jwk' });

export const accessTokenJwks = {
  keys: [{
    ...publicJwk,
    kid: env.JWT_ACCESS_KEY_ID,
    use: 'sig',
    alg: 'RS256',
  }],
};
