import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { NotificationService } from './notification.service';

// Shorter than the 24h email-verification token — a password-reset link is more sensitive.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

export function buildResetUrl(token: string): string {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
}

/** Generates a fresh password-reset token for `userId`, persists it, and (best-effort) emails the link. */
export async function issuePasswordReset(
  prisma: PrismaClient,
  notifier: NotificationService,
  userId: string,
  email: string,
): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.user.update({
    where: { id: userId },
    data: { passwordResetToken: token, passwordResetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  notifier.sendPasswordResetEmail(email, buildResetUrl(token)).catch((err) =>
    console.error('[Auth] Failed to send password reset email:', err),
  );
}
