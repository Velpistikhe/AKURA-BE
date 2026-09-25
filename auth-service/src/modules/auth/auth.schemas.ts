import { z } from 'zod';

const nullableEmail = z.string().trim().email('Invalid email address').max(255).transform(value => value.toLowerCase()).nullable().optional();
const nullableTelp = z.string().trim().min(1).max(50).nullable().optional();

export const registerSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain alphanumeric characters and underscores'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  passwordConfirmation: z.string().min(1, 'Password confirmation is required'),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: nullableEmail,
  telp: nullableTelp,
}).refine((value) => value.password === value.passwordConfirmation, {
  message: 'Password dan konfirmasi password berbeda',
  path: ['passwordConfirmation'],
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: nullableEmail,
  telp: nullableTelp,
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
  newPasswordConfirmation: z.string().min(1, 'New password confirmation is required'),
}).refine((value) => value.newPassword === value.newPasswordConfirmation, {
  message: 'Password baru dan konfirmasi password baru berbeda',
  path: ['newPasswordConfirmation'],
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
