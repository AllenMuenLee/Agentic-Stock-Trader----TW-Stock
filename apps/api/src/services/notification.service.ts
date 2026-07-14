import nodemailer from 'nodemailer';
import axios from 'axios';

export interface NotificationPayload {
  title: string;
  message: string;
  symbol?: string;
  signal?: string;
  price?: number;
}

export class NotificationService {
  private getTransporter(): nodemailer.Transporter | null {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  async sendEmail(to: string, payload: NotificationPayload): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.warn('[Notification] Email not configured');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: `[Stock Alert] ${payload.title}`,
      html: this.buildEmailHtml(payload),
    });

    console.log(`[Notification] Email sent to ${to}`);
  }

  /** Sends the account-activation email with a link back to the frontend's /verify-email page. */
  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.warn('[Notification] Email not configured — cannot send verification email');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: '請驗證您的 AI股探 帳號',
      html: this.buildVerificationEmailHtml(verifyUrl),
    });

    console.log(`[Notification] Verification email sent to ${to}`);
  }

  /** Sends the password-reset email with a link back to the frontend's /reset-password page. */
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.warn('[Notification] Email not configured — cannot send password reset email');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: '重設您的 AI股探 密碼',
      html: this.buildPasswordResetEmailHtml(resetUrl),
    });

    console.log(`[Notification] Password reset email sent to ${to}`);
  }

  async sendLine(lineUserId: string, payload: NotificationPayload): Promise<void> {
    const { LINE_CHANNEL_ACCESS_TOKEN } = process.env;

    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('[Notification] LINE not configured (missing LINE_CHANNEL_ACCESS_TOKEN)');
      return;
    }

    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: lineUserId,
        messages: [{ type: 'text', text: `${payload.title}\n${payload.message}` }],
      },
      { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } },
    );

    console.log(`[Notification] LINE message sent to ${lineUserId}`);
  }

  // Discord only allows a bot to DM a user if they share a guild. We require
  // users to join a designated server (DISCORD_GUILD_ID) as a workaround.
  async isDiscordGuildMember(discordUserId: string): Promise<boolean> {
    const { DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;
    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return false;

    try {
      await axios.get(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
      );
      return true;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return false;
      throw err;
    }
  }

  async sendDiscordDM(discordUserId: string, payload: NotificationPayload): Promise<void> {
    const { DISCORD_BOT_TOKEN } = process.env;

    if (!DISCORD_BOT_TOKEN) {
      console.warn('[Notification] Discord not configured (missing DISCORD_BOT_TOKEN)');
      return;
    }

    const color = payload.signal === 'BUY' ? 0x00ff00 : payload.signal === 'SELL' ? 0xff0000 : 0xffff00;

    // Create DM channel
    const dmRes = await axios.post(
      'https://discord.com/api/v10/users/@me/channels',
      { recipient_id: discordUserId },
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
    );
    const channelId = dmRes.data.id as string;

    // Send message
    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        embeds: [
          {
            title: payload.title,
            description: payload.message,
            color,
            fields: [
              ...(payload.symbol ? [{ name: 'Symbol', value: payload.symbol, inline: true }] : []),
              ...(payload.signal ? [{ name: 'Signal', value: payload.signal, inline: true }] : []),
              ...(payload.price ? [{ name: 'Price', value: `$${payload.price}`, inline: true }] : []),
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      },
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
    );

    console.log(`[Notification] Discord DM sent to user ${discordUserId}`);
  }

  /** Logo + brand header shared by every email template — table-based for compatibility with clients (e.g. Outlook) that don't support flexbox. */
  private buildEmailHeader(): string {
    const logoUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/Logo.png`;
    return `
      <table role="presentation" style="width: 100%; background: #1e293b; border-radius: 8px 8px 0 0;">
        <tr>
          <td style="padding: 16px 20px;">
            <img src="${logoUrl}" alt="AI股探" width="28" height="28" style="border-radius: 6px; vertical-align: middle;" />
            <span style="color: white; font-size: 20px; font-weight: bold; vertical-align: middle; margin-left: 10px;">AI股探</span>
          </td>
        </tr>
      </table>
    `;
  }

  private buildVerificationEmailHtml(verifyUrl: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${this.buildEmailHeader()}
        <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <h3 style="color: #1e293b;">請驗證您的帳號</h3>
          <p style="color: #475569;">感謝您註冊 AI股探！請點擊下方按鈕完成 Email 驗證，即可開始使用。</p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${verifyUrl}" style="background: #0ea5e9; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">驗證我的帳號</a>
          </p>
          <p style="color: #64748b; font-size: 13px;">若按鈕無法點擊，請複製以下連結至瀏覽器開啟：<br>${verifyUrl}</p>
          <p style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; color: #92400e; font-size: 13px;">
            📌 若收件匣中沒有看到這封信，請查看您的「垃圾郵件」或「促銷」資料夾。
          </p>
          <hr style="border-color: #e2e8f0;">
          <p style="font-size: 12px; color: #94a3b8;">此連結將於 24 小時後失效。若您並未註冊 AI股探，請忽略此信件。</p>
        </div>
      </div>
    `;
  }

  private buildPasswordResetEmailHtml(resetUrl: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${this.buildEmailHeader()}
        <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <h3 style="color: #1e293b;">重設您的密碼</h3>
          <p style="color: #475569;">我們收到您重設 AI股探 帳號密碼的請求。請點擊下方按鈕設定新密碼。</p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${resetUrl}" style="background: #0ea5e9; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">重設密碼</a>
          </p>
          <p style="color: #64748b; font-size: 13px;">若按鈕無法點擊，請複製以下連結至瀏覽器開啟：<br>${resetUrl}</p>
          <p style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; color: #92400e; font-size: 13px;">
            📌 若收件匣中沒有看到這封信，請查看您的「垃圾郵件」或「促銷」資料夾。
          </p>
          <hr style="border-color: #e2e8f0;">
          <p style="font-size: 12px; color: #94a3b8;">此連結將於 1 小時後失效。若您並未申請重設密碼，請忽略此信件，您的密碼不會被更改。</p>
        </div>
      </div>
    `;
  }

  private buildEmailHtml(payload: NotificationPayload): string {
    const signalColor =
      payload.signal === 'BUY' ? '#22c55e' : payload.signal === 'SELL' ? '#ef4444' : '#f59e0b';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${this.buildEmailHeader()}
        <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <h3 style="color: #1e293b;">${payload.title}</h3>
          ${payload.symbol ? `<p><strong>Symbol:</strong> ${payload.symbol}</p>` : ''}
          ${payload.signal ? `<p><strong>Signal:</strong> <span style="color: ${signalColor}; font-weight: bold;">${payload.signal}</span></p>` : ''}
          ${payload.price ? `<p><strong>Price:</strong> ${payload.price}</p>` : ''}
          <p style="color: #64748b;">${payload.message}</p>
          <hr style="border-color: #e2e8f0;">
          <p style="font-size: 12px; color: #94a3b8;">Sent by AI股探</p>
        </div>
      </div>
    `;
  }
}
