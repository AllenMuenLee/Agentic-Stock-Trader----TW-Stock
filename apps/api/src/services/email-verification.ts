import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { NotificationService } from './notification.service';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function buildVerifyUrl(token: string): string {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
}

/** Generates a fresh verification token for `userId`, persists it, and (best-effort) emails the link. Shared by registration, resend, and settings email changes. */
export async function issueVerification(
  prisma: PrismaClient,
  notifier: NotificationService,
  userId: string,
  email: string,
): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifyToken: token, emailVerifyTokenExpiry: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
  });
  notifier.sendVerificationEmail(email, buildVerifyUrl(token)).catch((err) =>
    console.error('[Auth] Failed to send verification email:', err),
  );
}
