import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class IngestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.INGEST_TOKEN;
    const authorization = context.switchToHttp().getRequest<Request>().header('authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!configured || !safeEqual(configured, supplied)) throw new UnauthorizedException();
    return true;
  }
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
