import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'keys/access-private.pem');

if (existsSync(target)) {
  throw new Error(`Refusing to overwrite existing private key: ${target}`);
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, privateKey, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`RSA access-token private key created at ${target}\n`);
