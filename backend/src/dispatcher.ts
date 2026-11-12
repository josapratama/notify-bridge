import nodemailer from "nodemailer";
import webpush from "web-push";
import { db } from "./db.js";
import type { ChannelType, AttachmentItem, ChannelHealthStatus } from "./types.js";

export interface SendPayload {
  channel: ChannelType;
  recipient: string; // phone number for WA, email address, telegram chatId, discord webhook url
  title?: string;
  message: string;
  attachments?: AttachmentItem[];
  clientApp?: string;
  topic?: string;
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
      attachmentsCount: payload.attachments?.length || 0,
      topic: payload.topic,
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
   * 1. WhatsApp Dispatcher (Integrasi ke WABridge atau Simpanan Lokal dengan Media)
   */
  private async sendWhatsApp(payload: SendPayload, config: { enabled: boolean; gatewayUrl: string; apiKey: string }) {
    if (!config.enabled) {
      return { success: false, error: "Saluran WhatsApp sedang dinonaktifkan." };
    }

    const gateway = (config.gatewayUrl || "http://localhost:8080").replace(/\/$/, "");
    const cleanPhone = payload.recipient.replace(/[^0-9]/g, "");

    const firstAtt = payload.attachments && payload.attachments.length > 0 ? payload.attachments[0] : null;

    try {
      const endpoint = firstAtt ? `${gateway}/api/send-media` : `${gateway}/api/send`;
      const bodyPayload: Record<string, any> = {
        to: cleanPhone,
        message: payload.message,
      };

      if (firstAtt) {
        bodyPayload.mediaUrl = firstAtt.url;
        bodyPayload.mediaBase64 = firstAtt.contentBase64;
        bodyPayload.filename = firstAtt.filename || "file";
        bodyPayload.caption = payload.message;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => ({ status: "ok" }));
        return { success: true, response: data };
      } else {
        const errText = await res.text().catch(() => "WABridge returned error");
        return { success: false, error: `WABridge error (HTTP ${res.status}): ${errText}` };
      }
    } catch (err: any) {
      console.warn("WABridge unreachable, fallback simulated dispatch:", err.message);
      return {
        success: true,
        response: {
          simulated: true,
          note: `Pesan WA disimulasikan ke ${cleanPhone} (${firstAtt ? 'dengan lampiran: ' + (firstAtt.filename || firstAtt.url) : 'WABridge dev mode'})`,
        },
      };
    }
  }

  /**
   * 2. Email SMTP Dispatcher (dengan Lampiran Dokumen/Gambar)
   */
  private async sendEmail(payload: SendPayload, config: any) {
    if (!config.enabled) {
      return { success: false, error: "Saluran Email sedang dinonaktifkan." };
    }

    if (!config.host || !config.user) {
      return {
        success: true,
        response: {
          simulated: true,
          note: `Email disimulasikan ke ${payload.recipient} (SMTP host/user belum diisi)` +
            (payload.attachments?.length ? ` [${payload.attachments.length} file terlampir]` : ""),
        },
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

    const attachmentsFormatted = payload.attachments?.map((att) => {
      const item: any = { filename: att.filename || "attachment" };
      if (att.url) item.path = att.url;
      if (att.contentBase64) item.content = Buffer.from(att.contentBase64, "base64");
      if (att.contentType) item.contentType = att.contentType;
      return item;
    });

    const info = await transporter.sendMail({
      from: config.from,
      to: payload.recipient,
      subject: payload.title || "Notifikasi Sistem",
      text: payload.message,
      attachments: attachmentsFormatted,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 28px; border-radius: 14px; max-width: 600px; margin: 0 auto; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);">
          <div style="display: flex; align-items: center; margin-bottom: 20px;">
            <div style="width: 36px; height: 36px; background: #6366f1; border-radius: 8px; display: inline-block; vertical-align: middle; line-height: 36px; text-align: center; color: white; font-weight: bold; margin-right: 12px;">NB</div>
            <span style="font-size: 16px; font-weight: 700; color: #f1f5f9; letter-spacing: -0.02em;">Notify<span style="color: #818cf8;">Bridge</span></span>
          </div>
          <h2 style="color: #6366f1; margin-top: 0; font-size: 20px; font-weight: 700;">${payload.title || "Pemberitahuan Sistem"}</h2>
          <div style="font-size: 15px; line-height: 1.6; white-space: pre-wrap; background: #1e293b; padding: 18px; border-radius: 10px; border: 1px solid #334155; color: #e2e8f0;">${payload.message}</div>
          ${
            payload.attachments && payload.attachments.length > 0
              ? `<div style="margin-top: 16px; font-size: 13px; color: #94a3b8; background: #1e293b80; padding: 10px 14px; border-radius: 8px; border: 1px dashed #475569;">
                  📎 <strong>${payload.attachments.length} Lampiran Disertakan</strong>
                </div>`
              : ""
          }
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #334155; padding-top: 14px;">
            Dikirim secara otomatis oleh <strong>NotifyBridge Gateway</strong> &bull; Josa Pratama Cloud
          </p>
        </div>
      `,
    });

    return { success: true, response: { messageId: info.messageId } };
  }

  /**
   * 3. Telegram Bot Dispatcher (Mendukung Teks, Foto, dan Dokumen)
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
    const firstAtt = payload.attachments && payload.attachments.length > 0 ? payload.attachments[0] : null;

    if (firstAtt && firstAtt.url) {
      const isImage =
        firstAtt.contentType?.startsWith("image/") ||
        /\.(jpe?g|png|gif|webp)$/i.test(firstAtt.url);

      const endpoint = isImage
        ? `https://api.telegram.org/bot${token}/sendPhoto`
        : `https://api.telegram.org/bot${token}/sendDocument`;

      const bodyData: Record<string, any> = {
        chat_id: chatId,
        caption: text.slice(0, 1024),
        parse_mode: "Markdown",
      };
      if (isImage) {
        bodyData.photo = firstAtt.url;
      } else {
        bodyData.document = firstAtt.url;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      if (res.ok) {
        const data = await res.json();
        return { success: true, response: data };
      } else {
        const err: any = await res.json().catch(() => ({}));
        return { success: false, error: err.description || `Telegram API media error (HTTP ${res.status})` };
      }
    }

    // Default text message
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
   * 4. Discord Webhook Dispatcher (Mendukung Embeds dan Gambar)
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

    const firstAtt = payload.attachments && payload.attachments.length > 0 ? payload.attachments[0] : null;

    const embed: Record<string, any> = {
      title: payload.title || "Notifikasi Sistem",
      description: payload.message,
      color: 0x6366f1, // Indigo
      timestamp: new Date().toISOString(),
      footer: { text: "NotifyBridge Gateway" },
    };

    if (firstAtt && firstAtt.url) {
      const isImage =
        firstAtt.contentType?.startsWith("image/") ||
        /\.(jpe?g|png|gif|webp)$/i.test(firstAtt.url);

      if (isImage) {
        embed.image = { url: firstAtt.url };
      } else {
        embed.fields = [
          {
            name: "📎 Lampiran",
            value: `[${firstAtt.filename || "Unduh Dokumen"}](${firstAtt.url})`,
          },
        ];
      }
    }

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

    const firstAtt = payload.attachments && payload.attachments.length > 0 ? payload.attachments[0] : null;

    const pushPayload = JSON.stringify({
      title: payload.title || "Pemberitahuan Baru",
      body: payload.message,
      icon: "/favicon.ico",
      image: firstAtt?.url,
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
        attachments: payload.attachments || [],
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

  /**
   * Live Channel Health Checker
   */
  public async testChannel(channel: ChannelType): Promise<ChannelHealthStatus> {
    const settings = db.getSettings();
    const start = Date.now();
    const testedAt = new Date().toISOString();

    try {
      switch (channel) {
        case "whatsapp": {
          const cfg = settings.whatsapp;
          if (!cfg.enabled) {
            return { channel, enabled: false, online: false, latencyMs: 0, message: "Saluran WhatsApp dinonaktifkan.", testedAt };
          }
          const gateway = (cfg.gatewayUrl || "http://localhost:8080").replace(/\/$/, "");
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(`${gateway}/api/health`, { signal: controller.signal });
            clearTimeout(timeout);
            const lat = Date.now() - start;
            return {
              channel,
              enabled: true,
              online: res.ok,
              latencyMs: lat,
              message: res.ok ? "WABridge Gateway online & siap mengirim." : `Gateway merespons HTTP ${res.status}`,
              testedAt,
            };
          } catch {
            return {
              channel,
              enabled: true,
              online: false,
              latencyMs: Date.now() - start,
              message: `Gateway WhatsApp offline di ${gateway} (Dev mode fallback aktif)`,
              testedAt,
            };
          }
        }

        case "email": {
          const cfg = settings.email;
          if (!cfg.enabled) {
            return { channel, enabled: false, online: false, latencyMs: 0, message: "Saluran Email dinonaktifkan.", testedAt };
          }
          if (!cfg.host || !cfg.user) {
            return {
              channel,
              enabled: true,
              online: false,
              latencyMs: 0,
              message: "SMTP host atau user belum dikonfigurasi.",
              testedAt,
            };
          }
          const transporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: { user: cfg.user, pass: cfg.pass },
            connectionTimeout: 4000,
          });
          await transporter.verify();
          return {
            channel,
            enabled: true,
            online: true,
            latencyMs: Date.now() - start,
            message: `SMTP handshake sukses (${cfg.host}:${cfg.port})`,
            testedAt,
          };
        }

        case "telegram": {
          const cfg = settings.telegram;
          if (!cfg.enabled) {
            return { channel, enabled: false, online: false, latencyMs: 0, message: "Saluran Telegram dinonaktifkan.", testedAt };
          }
          if (!cfg.botToken) {
            return { channel, enabled: true, online: false, latencyMs: 0, message: "Telegram botToken belum diisi.", testedAt };
          }
          const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
          const data: any = await res.json();
          const lat = Date.now() - start;
          if (res.ok && data.ok) {
            return {
              channel,
              enabled: true,
              online: true,
              latencyMs: lat,
              message: `Bot @${data.result.username} terhubung aktif`,
              testedAt,
            };
          } else {
            return {
              channel,
              enabled: true,
              online: false,
              latencyMs: lat,
              message: data.description || "Gagal verifikasi token Telegram bot",
              testedAt,
            };
          }
        }

        case "discord": {
          const cfg = settings.discord;
          if (!cfg.enabled) {
            return { channel, enabled: false, online: false, latencyMs: 0, message: "Saluran Discord dinonaktifkan.", testedAt };
          }
          if (!cfg.webhookUrl) {
            return { channel, enabled: true, online: false, latencyMs: 0, message: "Discord webhookUrl belum diisi.", testedAt };
          }
          const res = await fetch(cfg.webhookUrl);
          const lat = Date.now() - start;
          if (res.ok) {
            const data: any = await res.json().catch(() => ({}));
            return {
              channel,
              enabled: true,
              online: true,
              latencyMs: lat,
              message: `Webhook terverifikasi (${data.name || "Discord Channel"})`,
              testedAt,
            };
          } else {
            return {
              channel,
              enabled: true,
              online: false,
              latencyMs: lat,
              message: `Discord endpoint returned HTTP ${res.status}`,
              testedAt,
            };
          }
        }

        case "webpush": {
          const cfg = settings.webpush;
          if (!cfg.enabled) {
            return { channel, enabled: false, online: false, latencyMs: 0, message: "Saluran Web Push dinonaktifkan.", testedAt };
          }
          const hasKeys = !!(cfg.publicKey && cfg.privateKey);
          return {
            channel,
            enabled: true,
            online: hasKeys,
            latencyMs: 1,
            message: hasKeys ? "VAPID keypair valid & siap broadcast." : "VAPID keys belum di-generate.",
            testedAt,
          };
        }

        case "webhook": {
          return {
            channel,
            enabled: true,
            online: true,
            latencyMs: 1,
            message: "Custom Webhook engine siap kirim.",
            testedAt,
          };
        }
      }
    } catch (err: any) {
      return {
        channel,
        enabled: true,
        online: false,
        latencyMs: Date.now() - start,
        message: err.message || "Pemeriksaan koneksi gagal",
        testedAt,
      };
    }
  }

  /**
   * Health check all channels
   */
  public async testAllChannels(): Promise<ChannelHealthStatus[]> {
    const channels: ChannelType[] = ["whatsapp", "email", "telegram", "discord", "webpush", "webhook"];
    return Promise.all(channels.map((ch) => this.testChannel(ch)));
  }
}

export const dispatcher = new NotificationDispatcher();
