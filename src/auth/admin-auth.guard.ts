import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'schedule_admin_session';
const SESSION_TTL_SECONDS = 60 * 60;

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.ADMIN_TOKEN;
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const cookie = readCookie(request.header('cookie'), ADMIN_SESSION_COOKIE);
    if (!configured || (!safeEqual(configured, supplied) && !validSession(cookie, configured))) throw new UnauthorizedException();
    return true;
  }
}

export function createAdminSession(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${sign(String(expiresAt), secret)}`;
}

export function adminSessionMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

function validSession(value: string, secret: string): boolean {
  const [expiresAtText, signature, extra] = value.split('.');
  if (extra !== undefined || !/^\d+$/.test(expiresAtText) || !signature) return false;
  if (Number(expiresAtText) <= Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sign(expiresAtText, secret), signature);
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
