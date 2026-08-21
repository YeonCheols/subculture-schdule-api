import { Body, Controller, Delete, Get, Post, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminAuthGuard, ADMIN_SESSION_COOKIE, adminSessionMaxAge, createAdminSession } from '../auth/admin-auth.guard';
import { timingSafeEqual } from 'node:crypto';

@Controller('api/internal/admin/session')
export class EventImportsAdminSessionController {
  @Post()
  create(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const configured = process.env.ADMIN_TOKEN;
    const supplied = isRecord(body) && typeof body.token === 'string' ? body.token : '';
    if (!configured || !safeEqual(configured, supplied)) throw new UnauthorizedException();
    response.cookie(ADMIN_SESSION_COOKIE, createAdminSession(configured), cookieOptions(adminSessionMaxAge()));
    return { authenticated: true };
  }

  @Get()
  @UseGuards(AdminAuthGuard)
  status() {
    return { authenticated: true };
  }

  @Delete()
  clear(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(ADMIN_SESSION_COOKIE, cookieOptions(0));
    return { authenticated: false };
  }
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
