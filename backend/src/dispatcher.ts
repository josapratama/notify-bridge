import nodemailer from "nodemailer";
import webpush from "web-push";
import { db } from "./db.js";
import type { ChannelType } from "./types.js";

export interface SendPayload {
  channel: ChannelType;
  recipient: string; // phone number for WA, email address, telegram chatId, discord webhook url
  title?: string;
  message: string;
  clientApp?: string;
  extra?: Record<string, any>;
}

export interface SendResult {
  success: boolean;
  channel: ChannelType;
  recipient: string;
  response?: any;
  error?: string;
  latencyMs: number;
}

export class NotificationDispatcher {
  /**
   * Main dispatch function
   */
  public async dispatch(payload: SendPayload): Promise<SendResult> {
    const start = Date.now();
    const settings = db.getSettings();

    let result: { success: boolean; response?: any; error?: string };

    try {
      switch (payload.channel) {
        case "whatsapp":
          result = await this.sendWhatsApp(payload, settings.whatsapp);
          break;
        case "email":
          result = await this.sendEmail(payload, settings.email);
          break;
        case "telegram":
          result = await this.sendTelegram(payload, settings.telegram);
          break;
        case "discord":
          result = await this.sendDiscord(payload, settings.discord);
          break;
        case "webpush":
          result = await this.sendWebPush(payload, settings.webpush);
          break;
        case "webhook":
          result = await this.sendGenericWebhook(payload);
          break;
        default:
          result = { success: false, error: `Saluran tidak dikenal: ${payload.channel}` };
      }
    } catch (err: any) {
      result = { success: false, error: err.message || "Pengiriman gagal tak terduga" };
    }

    const latencyMs = Date.now() - start;

    // Log to store
    db.addLog({
      channel: payload.channel,
      recipient: payload.recipient,
      subject: payload.title,
      body: payload.message,
      status: result.success ? "delivered" : "failed",
      responsePayload: result.response,
      error: result.error,
      latencyMs,
      clientApp: payload.clientApp || "Direct API",
    });

    return {
      success: result.success,
      channel: payload.channel,
      recipient: payload.recipient,
      response: result.response,
      error: result.error,
      latencyMs,
    };
  }

  /**
   * 1. WhatsApp Dispatcher (Integrasi ke WABridge atau Simpanan Lokal)
   */
  private async sendWhatsApp(payload: SendPayload, config: { enabled: boolean; gatewayUrl: string; apiKey: string }) {
    if (!config.enabled) {
      return { success: false, error: "Saluran WhatsApp sedang dinonaktifkan." };
    }

    const gateway = config.gatewayUrl || "http://localhost:8080";
    const cleanPhone = payload.recipient.replace(/[^0-9]/g, "");

    try {
      // Panggil WABridge API endpoint
      const res = await fetch(`${gateway}/api/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          to: cleanPhone,
          message: payload.message,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({ status: "ok" }));
        return { success: true, response: data };
      } else {
        const errText = await res.text().catch(() => "WABridge returned error");
        return { success: false, error: `WABridge error (HTTP ${res.status}): ${errText}` };
      }
    } catch (err: any) {
      // Fallback simulasi jika gateway offline untuk development
      console.warn("WABridge offline, fallback simulated dispatch:", err.message);
      return {
        success: true,
        response: { simulated: true, note: `Pesan WA disimulasikan ke ${cleanPhone} (WABridge offline)` },
      };
    }
  }

  /**
   * 2. Email SMTP Dispatcher
   */
  private async sendEmail(payload: SendPayload, config: any) {
    if (!config.enabled) {
      return { success: false, error: "Saluran Email sedang dinonaktifkan." };
    }

    if (!config.host || !config.user) {
      // Simulasi email jika SMTP belum diset
      return {
        success: true,
        response: { simulated: true, note: `Email disimulasikan ke ${payload.recipient} (SMTP host/user belum diisi)` },
      };
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    const info = await transporter.sendMail({
      from: config.from,
      to: payload.recipient,
      subject: payload.title || "Notifikasi Sistem",
      text: payload.message,
      html: `
        <div style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px;">
          <h2 style="color: #6366f1; margin-top: 0;">${payload.title || "Notifikasi Baru"}</h2>
          <div style="font-size: 15px; line-height: 1.6; white-space: pre-wrap; background: #1e293b; padding: 16px; border-radius: 8px;">${payload.message}</div>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #334155; padding-top: 12px;">
            Dikirim secara otomatis oleh <strong>NotifyBridge Gateway</strong> &bull; Josa Pratama Cloud
          </p>
        </div>
      `,
    });

    return { success: true, response: { messageId: info.messageId } };
  }

  /**
   * 3. Telegram Bot Dispatcher
   */
  private async sendTelegram(payload: SendPayload, config: { enabled: boolean; botToken: string; defaultChatId?: string }) {
    if (!config.enabled) {
      return { success: false, error: "Saluran Telegram sedang dinonaktifkan." };
    }

    const token = config.botToken;
    const chatId = payload.recipient || config.defaultChatId;

    if (!token || !chatId) {
      return {
        success: true,
        response: { simulated: true, note: `Telegram disimulasikan (Bot token atau Chat ID belum diset)` },
      };
    }

    const text = payload.title ? `*${payload.title}*\n\n${payload.message}` : payload.message;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, response: data };
    } else {
      const err: any = await res.json().catch(() => ({}));
      return { success: false, error: err.description || `Telegram API error (HTTP ${res.status})` };
    }
  }

  /**
   * 4. Discord Webhook Dispatcher
   */
  private async sendDiscord(payload: SendPayload, config: { enabled: boolean; webhookUrl: string }) {
    if (!config.enabled) {
      return { success: false, error: "Saluran Discord sedang dinonaktifkan." };
    }

    const webhookUrl = payload.recipient.startsWith("http") ? payload.recipient : config.webhookUrl;
    if (!webhookUrl) {
      return {
        success: true,
        response: { simulated: true, note: `Discord disimulasikan (Webhook URL kosong)` },
      };
    }

    const embed = {
      title: payload.title || "Notifikasi Sistem",
      description: payload.message,
      color: 0x6366f1, // Indigo
      timestamp: new Date().toISOString(),
      footer: { text: "NotifyBridge Gateway" },
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "NotifyBridge Alert",
        avatar_url: "https://auth.josapratama.com/favicon.ico",
        embeds: [embed],
      }),
    });

    if (res.ok) {
      return { success: true, response: { status: "sent" } };
    } else {
      const err = await res.text().catch(() => "Discord error");
      return { success: false, error: `Discord webhook error: ${err}` };
    }
  }

  /**
   * 5. Web Push Notification Dispatcher
   */
  private async sendWebPush(payload: SendPayload, config: any) {
    if (!config.enabled) {
      return { success: false, error: "Saluran Web Push dinonaktifkan." };
    }

    const subs = db.getPushSubscriptions();
    if (subs.length === 0) {
      return {
        success: true,
        response: { simulated: true, note: `Belum ada browser yang terdaftar untuk push notification.` },
      };
    }

    try {
      webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    } catch {
      return {
        success: true,
        response: { simulated: true, note: `Push simulated (VAPID keys not generated yet)` },
      };
    }

    const pushPayload = JSON.stringify({
      title: payload.title || "Pemberitahuan Baru",
      body: payload.message,
      icon: "/favicon.ico",
    });

    let sentCount = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          pushPayload
        );
        sentCount++;
      } catch (err: any) {
        console.warn("Failed to push to endpoint", sub.endpoint, err?.message || err);
      }
    }

    return { success: true, response: { subscribersNotified: sentCount } };
  }

  /**
   * 6. Generic Custom Webhook Dispatcher
   */
  private async sendGenericWebhook(payload: SendPayload) {
    if (!payload.recipient.startsWith("http")) {
      return { success: false, error: "Recipient untuk webhook harus berupa URL HTTP/HTTPS yang valid." };
    }

    const res = await fetch(payload.recipient, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "notification.dispatched",
        title: payload.title,
        message: payload.message,
        timestamp: new Date().toISOString(),
        extra: payload.extra || {},
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({ status: "ok" }));
      return { success: true, response: data };
    } else {
      return { success: false, error: `Webhook endpoint returned HTTP ${res.status}` };
    }
  }
}

export const dispatcher = new NotificationDispatcher();
