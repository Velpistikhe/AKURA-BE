import { Request, Response } from 'express';
import {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '../config/auth.schemas.js';
import { authService } from '../services/auth.service.js';
import { getAuthenticatedUserId } from '../utils/authenticatedUser.js';
import { clearTokenCookies, setTokenCookies } from '../utils/cookies.js';
import { HttpError, RefreshTokenRejectedError } from '../utils/httpError.js';
import { getRefreshToken } from '../utils/requestTokens.js';

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const body = req.body as RegisterInput;
    await authService.register(
      body.username,
      body.password,
      body.firstName,
      body.lastName
    );
    res.status(201).json({
      status: 201,
      success: true,
      message: 'User registered successfully',
      requestId: req.headers['x-request-id'],
    });
  },

  async login(req: Request, res: Response): Promise<void> {
    const body = req.body as LoginInput;
    const result = await authService.login(body.username, body.password);
    setTokenCookies(res, result.tokens);
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Login successful',
      data: { user: result.user },
      requestId: req.headers['x-request-id'],
    });
  },

  async refreshToken(req: Request, res: Response): Promise<void> {
    const refreshToken = getRefreshToken(req);
    if (!refreshToken) {
      throw new HttpError('Refresh token is required in cookie or x-refresh-token header', 400);
    }
    try {
      const tokens = await authService.refreshToken(refreshToken);
      setTokenCookies(res, tokens);
      res.status(200).json({
        status: 200,
        success: true,
        message: 'Token refreshed successfully',
        requestId: req.headers['x-request-id'],
      });
    } catch (error) {
      if (error instanceof RefreshTokenRejectedError) clearTokenCookies(res);
      throw error;
    }
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(getRefreshToken(req));
    clearTokenCookies(res);
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Logout successful',
      requestId: req.headers['x-request-id'],
    });
  },

  async getProfile(req: Request, res: Response): Promise<void> {
    const user = await authService.getProfile(getAuthenticatedUserId(req));
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Profile retrieved successfully',
      data: user,
      requestId: req.headers['x-request-id'],
    });
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const body = req.body as UpdateProfileInput;
    const user = await authService.updateProfile(
      getAuthenticatedUserId(req),
      body.firstName,
      body.lastName
    );
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Profile updated successfully',
      data: user,
      requestId: req.headers['x-request-id'],
    });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const body = req.body as ChangePasswordInput;
    const user = await authService.changePassword(
      getAuthenticatedUserId(req),
      body.oldPassword,
      body.newPassword
    );
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Password changed successfully',
      data: user,
      requestId: req.headers['x-request-id'],
    });
  },
};
