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
          <p style="font-size: 12px; color: #94a3b8;">Sent by 智股通</p>
        </div>
      </div>
    `;
  }
}
