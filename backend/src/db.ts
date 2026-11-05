import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  NotifyBridgeStore,
  ChannelSettings,
  NotificationTemplate,
  NotificationLog,
  ApiKeyItem,
  PushSubscriptionItem,
} from "./types.js";
import {
  WABRIDGE_URL,
  WABRIDGE_TOKEN,
  TELEGRAM_BOT_TOKEN,
  DISCORD_WEBHOOK_URL,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
} from "./config.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.resolve(DATA_DIR, "notify-bridge-store.json");

function getDefaultData(): NotifyBridgeStore {
  return {
    settings: {
      whatsapp: {
        enabled: true,
        gatewayUrl: WABRIDGE_URL,
        apiKey: WABRIDGE_TOKEN,
      },
      email: {
        enabled: true,
        host: SMTP_HOST || "smtp.gmail.com",
        port: SMTP_PORT || 587,
        secure: SMTP_SECURE,
        user: SMTP_USER,
        pass: SMTP_PASS,
        from: SMTP_FROM,
      },
      telegram: {
        enabled: true,
        botToken: TELEGRAM_BOT_TOKEN,
        defaultChatId: "",
      },
      discord: {
        enabled: true,
        webhookUrl: DISCORD_WEBHOOK_URL,
      },
      webpush: {
        enabled: true,
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
        subject: VAPID_SUBJECT,
      },
    },
    templates: [
      {
        id: "tpl_otp",
        name: "OTP & Kode Verifikasi",
        slug: "otp_verification",
        channels: ["whatsapp", "email", "telegram"],
        titleTemplate: "Kode Verifikasi {{appName}}",
        bodyTemplate: "Halo {{name}},\n\nKode verifikasi Anda adalah: *{{otp}}*\nKode ini berlaku selama {{validMinutes}} menit. Jangan berikan kepada siapa pun.",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "tpl_alert",
        name: "Peringatan Server & Insiden",
        slug: "server_incident",
        channels: ["telegram", "discord", "whatsapp"],
        titleTemplate: "🚨 ALERT: Layanan {{serviceName}} Down!",
        bodyTemplate: "🚨 *Peringatan Sistem*\n\nLayanan: *{{serviceName}}*\nStatus: *DOWN*\nWaktu: {{time}}\nDetail: {{details}}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "tpl_invoice",
        name: "Konfirmasi Pembayaran Sukses",
        slug: "payment_success",
        channels: ["whatsapp", "email"],
        titleTemplate: "Pembayaran Berhasil #{{invoiceNumber}}",
        bodyTemplate: "Terima kasih {{name}},\n\nPembayaran invoice *{{invoiceNumber}}* sebesar *{{amount}}* telah berhasil diverifikasi.\nLayanan Anda telah aktif.",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    logs: [],
    apiKeys: [
      {
        id: "key_default_guidepath",
        name: "GuidePath Academic Thesis",
        key: "nb_live_guidepath_" + crypto.randomBytes(12).toString("hex"),
        clientSlug: "guidepath",
        createdAt: new Date().toISOString(),
      },
      {
        id: "key_default_minihost",
        name: "Mini VPS Panel",
        key: "nb_live_minihost_" + crypto.randomBytes(12).toString("hex"),
        clientSlug: "minihost",
        createdAt: new Date().toISOString(),
      },
      {
        id: "key_default_authhub",
        name: "AuthHub SSO",
        key: "nb_live_authhub_" + crypto.randomBytes(12).toString("hex"),
        clientSlug: "auth-hub",
        createdAt: new Date().toISOString(),
      },
    ],
    pushSubscriptions: [],
  };
}

class NotifyDb {
  private data: NotifyBridgeStore;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        this.data = JSON.parse(raw);
      } catch (err) {
        console.warn("Failed to parse existing DB file, reinitializing...", err);
        this.data = getDefaultData();
        this.save();
      }
    } else {
      this.data = getDefaultData();
      this.save();
    }
  }

  private save() {
    try {
      const tempFile = `${DB_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error("Failed to persist database file", err);
    }
  }

  public getSettings(): ChannelSettings {
    return this.data.settings;
  }

  public updateSettings(settings: Partial<ChannelSettings>) {
    this.data.settings = { ...this.data.settings, ...settings };
    this.save();
    return this.data.settings;
  }

  public getTemplates(): NotificationTemplate[] {
    return this.data.templates;
  }

  public getTemplateBySlug(slug: string): NotificationTemplate | undefined {
    return this.data.templates.find((t) => t.slug === slug);
  }

  public saveTemplate(t: Omit<NotificationTemplate, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
    const now = new Date().toISOString();
    if (t.id) {
      const idx = this.data.templates.findIndex((x) => x.id === t.id);
      if (idx !== -1) {
        this.data.templates[idx] = {
          ...this.data.templates[idx],
          ...t,
          updatedAt: now,
        };
        this.save();
        return this.data.templates[idx];
      }
    }
    const newTpl: NotificationTemplate = {
      id: "tpl_" + crypto.randomBytes(6).toString("hex"),
      name: t.name,
      slug: t.slug,
      channels: t.channels,
      titleTemplate: t.titleTemplate,
      bodyTemplate: t.bodyTemplate,
      createdAt: now,
      updatedAt: now,
    };
    this.data.templates.push(newTpl);
    this.save();
    return newTpl;
  }

  public deleteTemplate(id: string): boolean {
    const before = this.data.templates.length;
    this.data.templates = this.data.templates.filter((t) => t.id !== id);
    if (this.data.templates.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public getLogs(limit = 100): NotificationLog[] {
    return this.data.logs.slice(-limit).reverse();
  }

  public addLog(log: Omit<NotificationLog, "id" | "createdAt">): NotificationLog {
    const item: NotificationLog = {
      id: "log_" + crypto.randomBytes(8).toString("hex"),
      createdAt: new Date().toISOString(),
      ...log,
    };
    this.data.logs.push(item);
    // Keep max 1000 logs to prevent memory bloat
    if (this.data.logs.length > 1000) {
      this.data.logs = this.data.logs.slice(-1000);
    }
    this.save();
    return item;
  }

  public getApiKeys(): ApiKeyItem[] {
    return this.data.apiKeys;
  }

  public findApiKey(key: string): ApiKeyItem | undefined {
    return this.data.apiKeys.find((k) => k.key === key);
  }

  public createApiKey(name: string, clientSlug: string): ApiKeyItem {
    const item: ApiKeyItem = {
      id: "key_" + crypto.randomBytes(6).toString("hex"),
      name,
      clientSlug,
      key: `nb_live_${clientSlug}_${crypto.randomBytes(16).toString("hex")}`,
      createdAt: new Date().toISOString(),
    };
    this.data.apiKeys.push(item);
    this.save();
    return item;
  }

  public deleteApiKey(id: string): boolean {
    const before = this.data.apiKeys.length;
    this.data.apiKeys = this.data.apiKeys.filter((k) => k.id !== id);
    if (this.data.apiKeys.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public addPushSubscription(sub: Omit<PushSubscriptionItem, "id" | "createdAt">): PushSubscriptionItem {
    const existing = this.data.pushSubscriptions.find((s) => s.endpoint === sub.endpoint);
    if (existing) return existing;

    const item: PushSubscriptionItem = {
      id: "sub_" + crypto.randomBytes(6).toString("hex"),
      createdAt: new Date().toISOString(),
      ...sub,
    };
    this.data.pushSubscriptions.push(item);
    this.save();
    return item;
  }

  public getPushSubscriptions(): PushSubscriptionItem[] {
    return this.data.pushSubscriptions;
  }
}

export const db = new NotifyDb();
