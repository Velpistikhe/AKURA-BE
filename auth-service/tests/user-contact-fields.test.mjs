import assert from 'node:assert/strict';
import { registerSchema, updateProfileSchema } from '../dist/modules/auth/auth.schemas.js';
import { updateUserSchema } from '../dist/modules/user-management/user-management.schemas.js';
import { sanitizeUser } from '../dist/utils/userMapper.js';

// Register accepts nullable email/telp and normalizes email to lowercase.
const base = { username: 'contact_test', password: 'secret123', passwordConfirmation: 'secret123', firstName: 'Artha', lastName: 'Marketing' };
const created = registerSchema.parse({ ...base, email: '  Artha@AkuraBinaCitra.COM ', telp: '+62 811 1919 4233' });
assert.equal(created.email, 'artha@akurabinacitra.com');
assert.equal(created.telp, '+62 811 1919 4233');
// Omitting the fields keeps them optional.
assert.equal(registerSchema.parse(base).email, undefined);
// Explicit null is accepted to clear the contact fields.
assert.equal(registerSchema.parse({ ...base, email: null, telp: null }).email, null);
// Invalid values are rejected.
assert.throws(() => registerSchema.parse({ ...base, email: 'not-an-email' }));
assert.throws(() => registerSchema.parse({ ...base, telp: 'x'.repeat(51) }));
assert.throws(() => registerSchema.parse({ ...base, email: 'a'.repeat(260) + '@x.co' }));

// Profile update: omit keeps the value, null clears it.
const profile = updateProfileSchema.parse({ firstName: 'Artha', lastName: 'Marketing', email: null, telp: null });
assert.equal(profile.email, null);
assert.equal(updateProfileSchema.parse({ firstName: 'A', lastName: 'B' }).email, undefined);
assert.throws(() => updateProfileSchema.parse({ firstName: 'A', lastName: 'B', email: 'bad' }));

// App manager user update: email/telp set and cleared with version.
const managed = updateUserSchema.parse({ version: 1, email: 'Admin@Example.com ', telp: '+62 812 6100 1050' });
assert.equal(managed.email, 'admin@example.com');
assert.equal(managed.telp, '+62 812 6100 1050');
assert.equal(updateUserSchema.parse({ version: 2, email: null, telp: null }).email, null);
assert.throws(() => updateUserSchema.parse({ version: 1, email: 'nope' }));
assert.throws(() => updateUserSchema.parse({ version: 1, telp: 'y'.repeat(51) }));

// Response mapper always exposes the nullable contact fields.
const sanitized = sanitizeUser({
  id: '00000000-0000-4000-8000-000000000001', username: 'artha', normalizeUsername: 'artha',
  firstName: 'Artha', lastName: 'Marketing', email: 'artha@akurabinacitra.com', telp: '+6281119194233',
  role: 'ADMIN', section: 'MARKETING', officeBranchId: '00000000-0000-4000-8000-000000000002',
  isActive: true, version: 1, createdAt: new Date(), updatedAt: new Date(),
});
assert.equal(sanitized.email, 'artha@akurabinacitra.com');
assert.equal(sanitized.telp, '+6281119194233');
const withoutContacts = sanitizeUser({ ...sanitized, email: null, telp: null });
assert.equal(withoutContacts.email, null);
assert.equal(withoutContacts.telp, null);

console.log('PASS: user email/telp validation, normalization, clearing and response mapping.');
