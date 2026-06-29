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
  async sendEmail(to: string, payload: NotificationPayload): Promise<void> {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.warn('[Notification] Email not configured');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to,
      subject: `[Stock Alert] ${payload.title}`,
      html: this.buildEmailHtml(payload),
    });

    console.log(`[Notification] Email sent to ${to}`);
  }

  async sendLine(token: string, payload: NotificationPayload): Promise<void> {
    const { LINE_CHANNEL_ACCESS_TOKEN } = process.env;

    // LINE Notify (simple token-based)
    if (token.startsWith('notify:')) {
      const notifyToken = token.replace('notify:', '');
      await axios.post(
        'https://notify-api.line.me/api/notify',
        new URLSearchParams({ message: `\n${payload.title}\n${payload.message}` }),
        {
          headers: {
            Authorization: `Bearer ${notifyToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      return;
    }

    // LINE Messaging API
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('[Notification] LINE not configured');
      return;
    }

    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: token,
        messages: [{ type: 'text', text: `${payload.title}\n${payload.message}` }],
      },
      { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } },
    );

    console.log(`[Notification] LINE message sent`);
  }

  async sendDiscord(webhookUrl: string, payload: NotificationPayload): Promise<void> {
    const color = payload.signal === 'BUY' ? 0x00ff00 : payload.signal === 'SELL' ? 0xff0000 : 0xffff00;

    await axios.post(webhookUrl, {
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
    });

    console.log(`[Notification] Discord message sent`);
  }

  private buildEmailHtml(payload: NotificationPayload): string {
    const signalColor =
      payload.signal === 'BUY' ? '#22c55e' : payload.signal === 'SELL' ? '#ef4444' : '#f59e0b';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e293b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">📊 Stock Signal Alert</h2>
        </div>
        <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <h3 style="color: #1e293b;">${payload.title}</h3>
          ${payload.symbol ? `<p><strong>Symbol:</strong> ${payload.symbol}</p>` : ''}
          ${payload.signal ? `<p><strong>Signal:</strong> <span style="color: ${signalColor}; font-weight: bold;">${payload.signal}</span></p>` : ''}
          ${payload.price ? `<p><strong>Price:</strong> ${payload.price}</p>` : ''}
          <p style="color: #64748b;">${payload.message}</p>
          <hr style="border-color: #e2e8f0;">
          <p style="font-size: 12px; color: #94a3b8;">Sent by Agentic Stock Notifier</p>
        </div>
      </div>
    `;
  }
}
