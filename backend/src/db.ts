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
  TopicRoute,
  QueueItem,
  ChannelType,
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
    routes: [
      {
        id: "route_security",
        topic: "security",
        name: "Security & Authentication Alerts",
        description: "Notifikasi login baru, reset password, dan suspicious activity ke Telegram & Discord",
        channels: ["telegram", "discord"],
        defaultRecipients: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "route_billing",
        topic: "billing",
        name: "Billing & Transactions",
        description: "Notifikasi invoice baru, konfirmasi pembayaran, dan langganan ke WhatsApp & Email",
        channels: ["whatsapp", "email"],
        defaultRecipients: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "route_system_ops",
        topic: "system-alert",
        name: "DevOps & System Monitoring",
        description: "Broadcast peringatan server crash atau kuota habis ke Discord & Telegram",
        channels: ["discord", "telegram"],
        defaultRecipients: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    queue: [],
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
        const parsed = JSON.parse(raw);
        this.data = {
          ...getDefaultData(),
          ...parsed,
          settings: { ...getDefaultData().settings, ...(parsed.settings || {}) },
          templates: parsed.templates || getDefaultData().templates,
          logs: parsed.logs || [],
          apiKeys: parsed.apiKeys || getDefaultData().apiKeys,
          pushSubscriptions: parsed.pushSubscriptions || [],
          routes: parsed.routes && parsed.routes.length > 0 ? parsed.routes : getDefaultData().routes,
          queue: parsed.queue || [],
        };
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

  // ─── Topic-Based Routing ─────────────────────────────────────
  public getRoutes(): TopicRoute[] {
    return this.data.routes || [];
  }

  public getRouteByTopic(topic: string): TopicRoute | undefined {
    return (this.data.routes || []).find((r) => r.topic === topic && r.enabled);
  }

  public saveRoute(route: Omit<TopicRoute, "id" | "createdAt" | "updatedAt"> & { id?: string }): TopicRoute {
    const now = new Date().toISOString();
    if (!this.data.routes) this.data.routes = [];

    if (route.id) {
      const idx = this.data.routes.findIndex((r) => r.id === route.id);
      if (idx !== -1) {
        this.data.routes[idx] = {
          ...this.data.routes[idx],
          ...route,
          updatedAt: now,
        };
        this.save();
        return this.data.routes[idx];
      }
    }

    const newRoute: TopicRoute = {
      id: "route_" + crypto.randomBytes(6).toString("hex"),
      topic: route.topic.trim().toLowerCase(),
      name: route.name,
      description: route.description || "",
      channels: route.channels,
      defaultRecipients: route.defaultRecipients || {},
      enabled: route.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.routes.push(newRoute);
    this.save();
    return newRoute;
  }

  public deleteRoute(id: string): boolean {
    if (!this.data.routes) return false;
    const before = this.data.routes.length;
    this.data.routes = this.data.routes.filter((r) => r.id !== id);
    if (this.data.routes.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  // ─── Smart Queue & Scheduler ─────────────────────────────────
  public getQueue(): QueueItem[] {
    return this.data.queue || [];
  }

  public enqueue(item: Omit<QueueItem, "id" | "attempts" | "status" | "createdAt" | "updatedAt">): QueueItem {
    if (!this.data.queue) this.data.queue = [];
    const now = new Date().toISOString();
    const queueItem: QueueItem = {
      id: "q_" + crypto.randomBytes(8).toString("hex"),
      ...item,
      attempts: 0,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.data.queue.push(queueItem);
    this.save();
    return queueItem;
  }

  public updateQueueItem(id: string, updates: Partial<QueueItem>): QueueItem | undefined {
    if (!this.data.queue) return undefined;
    const item = this.data.queue.find((q) => q.id === id);
    if (item) {
      Object.assign(item, updates, { updatedAt: new Date().toISOString() });
      this.save();
      return item;
    }
    return undefined;
  }

  public deleteQueueItem(id: string): boolean {
    if (!this.data.queue) return false;
    const before = this.data.queue.length;
    this.data.queue = this.data.queue.filter((q) => q.id !== id);
    if (this.data.queue.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public cleanupCompletedQueue(retentionMs = 86400000): number {
    if (!this.data.queue) return 0;
    const now = Date.now();
    const before = this.data.queue.length;
    this.data.queue = this.data.queue.filter((q) => {
      if (q.status === "delivered" || q.status === "failed") {
        return now - new Date(q.updatedAt).getTime() < retentionMs;
      }
      return true;
    });
    if (this.data.queue.length !== before) {
      this.save();
    }
    return before - this.data.queue.length;
  }

  // ─── Analytics & Metrics ─────────────────────────────────────
  public getAnalytics() {
    const logs = this.data.logs || [];
    const total = logs.length;
    const delivered = logs.filter((l) => l.status === "delivered" || l.status === "sent").length;
    const failed = logs.filter((l) => l.status === "failed").length;
    const successRate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 100;

    const channelStats: Record<string, { total: number; delivered: number; failed: number; avgLatencyMs: number; totalLatencyMs: number }> = {
      whatsapp: { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 },
      email: { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 },
      telegram: { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 },
      discord: { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 },
      webpush: { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 },
      webhook: { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 },
    };

    let totalLatency = 0;
    for (const log of logs) {
      const ch = log.channel || "whatsapp";
      if (!channelStats[ch]) {
        channelStats[ch] = { total: 0, delivered: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 };
      }
      channelStats[ch].total++;
      if (log.status === "delivered" || log.status === "sent") {
        channelStats[ch].delivered++;
      } else {
        channelStats[ch].failed++;
      }
      const lat = log.latencyMs || 0;
      channelStats[ch].totalLatencyMs += lat;
      totalLatency += lat;
    }

    for (const ch of Object.keys(channelStats)) {
      if (channelStats[ch].total > 0) {
        channelStats[ch].avgLatencyMs = Math.round(channelStats[ch].totalLatencyMs / channelStats[ch].total);
      }
    }

    const overallAvgLatency = total > 0 ? Math.round(totalLatency / total) : 0;

    // Daily volume for the last 7 days
    const dailyVolume: Record<string, { date: string; total: number; delivered: number; failed: number }> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      dailyVolume[key] = { date: key, total: 0, delivered: 0, failed: 0 };
    }

    for (const log of logs) {
      const day = (log.createdAt || "").slice(0, 10);
      if (dailyVolume[day]) {
        dailyVolume[day].total++;
        if (log.status === "delivered" || log.status === "sent") {
          dailyVolume[day].delivered++;
        } else {
          dailyVolume[day].failed++;
        }
      }
    }

    const queue = this.data.queue || [];
    const queueStats = {
      total: queue.length,
      pending: queue.filter((q) => q.status === "queued").length,
      processing: queue.filter((q) => q.status === "processing").length,
      failed: queue.filter((q) => q.status === "failed").length,
      delivered: queue.filter((q) => q.status === "delivered").length,
    };

    return {
      summary: {
        totalDispatched: total,
        delivered,
        failed,
        successRate,
        overallAvgLatencyMs: overallAvgLatency,
      },
      channelStats,
      dailyVolume: Object.values(dailyVolume),
      queueStats,
    };
  }
}

export const db = new NotifyDb();
