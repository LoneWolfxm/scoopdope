import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditAction } from './audit-log.entity';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (user?.apiKey) {
      const ip = this.extractClientIp(req);
      const ua = req.headers['user-agent'];
      this.auditService.log(AuditAction.API_KEY_USED, user.userId, true, { apiKeyId: user.apiKeyId }, ip, ua);
    }

    return next.handle();
  }

  /**
   * Extract the client IP from the request, preferring the first hop of the
   * X-Forwarded-For header (for load-balanced deployments) and falling back
   * to req.ip / req.connection.remoteAddress. The returned IP is masked for
   * privacy compliance.
   */
  private extractClientIp(req: any): string | undefined {
    let ip: string | undefined;

    const forwardedFor = req?.headers?.['x-forwarded-for'];
    if (forwardedFor) {
      const headerValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      const firstHop = String(headerValue).split(',')[0].trim();
      if (firstHop) {
        ip = firstHop;
      }
    }

    if (!ip) {
      ip = req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress;
    }

    if (!ip) {
      return undefined;
    }

    return this.maskIp(ip);
  }

  /**
   * Mask the last octet of IPv4 addresses (192.168.1.42 -> 192.168.1.*) and
   * the last group of IPv6 addresses for privacy compliance.
   */
  private maskIp(ip: string): string {
    let address = String(ip).trim();

    // Strip an IPv4-mapped IPv6 prefix (::ffff:192.168.1.42).
    if (address.toLowerCase().startsWith('::ffff:')) {
      address = address.slice('::ffff:'.length);
    }

    // Strip a port suffix from IPv4 addresses (e.g. 192.168.1.42:1234).
    if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(address)) {
      address = address.split(':')[0];
    }

    if (address.includes(':')) {
      // IPv6: mask the last group.
      const groups = address.split(':');
      groups[groups.length - 1] = '*';
      return groups.join(':');
    }

    const octets = address.split('.');
    if (octets.length === 4) {
      octets[3] = '*';
      return octets.join('.');
    }

    return address;
  }
}