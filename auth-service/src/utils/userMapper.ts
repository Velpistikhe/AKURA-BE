import { User } from '@prisma/client';
import { UserSanitized } from '../types/auth.types.js';

export const sanitizeUser = (user: User): UserSanitized => ({
  id: user.id,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  section: user.section,
  isActive: user.isActive,
  version: user.version,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
