import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import {
  PORT,
  AUTHHUB_URL,
  AUTHHUB_CLIENT_ID,
  AUTHHUB_REDIRECT_URI,
} from "./config.js";
import { db } from "./db.js";
import { dispatcher } from "./dispatcher.js";
import { queueRunner } from "./queue.js";
import {
  authenticate,
  requireAdminOrApiKey,
  exchangeOAuthCode,
} from "./auth.js";
import type { ChannelType, AttachmentItem } from "./types.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(authenticate);

// Dynamically resolve built Angular frontend path
function getFrontendDistPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "../frontend/dist/frontend/browser"),
    path.resolve(process.cwd(), "frontend/dist/frontend/browser"),
    path.resolve(process.cwd(), "dist/frontend/browser"),
    path.resolve(__dirname, "../frontend/dist/frontend/browser"),
    path.resolve(__dirname, "../../frontend/dist/frontend/browser"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      console.log(`📦 [NotifyBridge] Serving Angular frontend from: ${c}`);
      return c;
    }
  }
  return candidates[0];
}

const FRONTEND_DIST = getFrontendDistPath();
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
}

// ─── Health & Metadata ──────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "NotifyBridge Multi-Channel Notification Hub",
    version: "2.0.0",
    authHubUrl: AUTHHUB_URL,
    features: [
      "smart-queue",
      "retry-backoff",
      "topic-routing",
      "media-attachments",
      "scheduled-delivery",
      "health-checker",
      "delivery-webhooks",
      "analytics-engine",
    ],
    timestamp: new Date().toISOString(),
  });
});

// ─── AuthHub SSO ─────────────────────────────────────────────
app.get("/api/auth/config", (req: Request, res: Response) => {
  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || `localhost:${PORT}`;
  const dynamicRedirect = `${protocol}://${host}/auth/callback`;
  const resolvedRedirect = AUTHHUB_REDIRECT_URI || dynamicRedirect;

  res.json({
    authHubUrl: AUTHHUB_URL,
    clientId: AUTHHUB_CLIENT_ID,
    clientSlug: "notify-bridge",
    redirectUri: resolvedRedirect,
    ssoLoginUrl: `${AUTHHUB_URL}/oauth/authorize?client_id=${AUTHHUB_CLIENT_ID}&client_slug=notify-bridge&redirect_uri=${encodeURIComponent(
      resolvedRedirect
    )}&response_type=code&state=sso_notifybridge`,
  });
});

app.post("/api/auth/callback", async (req: Request, res: Response) => {
  const { code, redirectUri } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Parameter 'code' otorisasi wajib disertakan." });
  }

  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || `localhost:${PORT}`;
  const fallbackRedirect = `${protocol}://${host}/auth/callback`;

  try {
    const result = await exchangeOAuthCode(code, redirectUri || AUTHHUB_REDIRECT_URI || fallbackRedirect);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Gagal otorisasi dengan AuthHub." });
  }
});

app.get("/api/auth/me", (req: Request, res: Response) => {
  if (!req.user) {
    return res.json({ authenticated: false, user: null });
  }
  const isSuper = req.user.globalRole === "superadmin" || req.user.appRole === "superadmin";
  res.json({
    authenticated: true,
    user: req.user,
    canEdit: isSuper || req.user.appRole === "admin" || req.user.appRole === "editor",
    isAdmin: isSuper || req.user.appRole === "admin",
  });
});

// ─── 🚀 Universal Send API (v2) ──────────────────────────────
app.post("/api/v1/send", requireAdminOrApiKey, async (req: Request, res: Response) => {
  const {
    channel,
    channels,
    recipient,
    recipients,
    title,
    message,
    template,
    data = {},
    fallbackChannels = [],
    topic,
    attachments = [],
    sendAt,
    delaySeconds,
    queue: forceQueue = false,
    callbackUrl,
  } = req.body;

  let finalTitle = title || "";
  let finalMessage = message || "";
  let targetChannels: ChannelType[] = channels || (channel ? [channel] : []);
  let targetRecipients: string[] = recipients || (recipient ? [recipient] : []);

  // 1. Topic-Based Smart Routing
  if (topic) {
    const route = db.getRouteByTopic(topic);
    if (route) {
      if (targetChannels.length === 0) {
        targetChannels = [...route.channels];
      }
      if (targetRecipients.length === 0 && route.defaultRecipients) {
        for (const ch of targetChannels) {
          const defRec = route.defaultRecipients[ch];
          if (defRec) targetRecipients.push(defRec);
        }
      }
    }
  }

  // Fallback to default channel if none specified
  if (targetChannels.length === 0) {
    targetChannels = ["whatsapp"];
  }

  // 2. Process Template if specified
  if (template) {
    const tpl = db.getTemplateBySlug(template);
    if (!tpl) {
      return res.status(404).json({ error: `Template '${template}' tidak ditemukan.` });
    }
    finalTitle = tpl.titleTemplate || finalTitle;
    finalMessage = tpl.bodyTemplate;

    // Replace placeholders e.g. {{name}}, {{otp}}
    for (const [key, val] of Object.entries(data)) {
      const reg = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      finalTitle = finalTitle.replace(reg, String(val));
      finalMessage = finalMessage.replace(reg, String(val));
    }
  }

  if (!finalMessage) {
    return res.status(400).json({ error: "Konten 'message' atau 'template' wajib disertakan." });
  }

  if (targetRecipients.length === 0) {
    return res.status(400).json({ error: "Tujuan penerima ('recipient' atau 'recipients') wajib disertakan." });
  }

  const clientIdentifier = req.apiKeyClient || req.user?.username || "API Client";

  // 3. Scheduled / Delayed / Queued Processing
  const isScheduled =
    forceQueue ||
    !!sendAt ||
    (typeof delaySeconds === "number" && delaySeconds > 0);

  if (isScheduled) {
    const queuedItems = [];
    for (const ch of targetChannels) {
      for (const r of targetRecipients) {
        const item = queueRunner.enqueueItem({
          channel: ch,
          recipient: r,
          title: finalTitle,
          message: finalMessage,
          attachments: attachments as AttachmentItem[],
          clientApp: clientIdentifier,
          topic,
          callbackUrl,
          sendAt,
          delaySeconds,
        });
        queuedItems.push(item);
      }
    }

    return res.status(202).json({
      success: true,
      queued: true,
      queuedCount: queuedItems.length,
      items: queuedItems.map((q) => ({
        id: q.id,
        channel: q.channel,
        recipient: q.recipient,
        scheduledFor: new Date(q.scheduledFor).toISOString(),
        status: q.status,
      })),
      note: "Notifikasi berhasil masuk ke antrean dan akan dikirim secara asynchronous.",
    });
  }

  // 4. Synchronous Direct Dispatch
  const results = [];

  for (const ch of targetChannels) {
    for (const r of targetRecipients) {
      let dispatchRes = await dispatcher.dispatch({
        channel: ch,
        recipient: r,
        title: finalTitle,
        message: finalMessage,
        attachments: attachments as AttachmentItem[],
        clientApp: clientIdentifier,
        topic,
      });

      // If failed and fallback channels are set, attempt cascade fallback!
      if (!dispatchRes.success && fallbackChannels.length > 0) {
        for (const fbChannel of fallbackChannels) {
          const fbRes = await dispatcher.dispatch({
            channel: fbChannel,
            recipient: r,
            title: `[Fallback] ${finalTitle}`,
            message: finalMessage,
            attachments: attachments as AttachmentItem[],
            clientApp: `${clientIdentifier} (Fallback from ${ch})`,
            topic,
          });
          if (fbRes.success) {
            dispatchRes = fbRes;
            break;
          }
        }
      }

      // Fire callback if immediate dispatch requested callback
      if (callbackUrl && callbackUrl.startsWith("http")) {
        try {
          fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "notification.status",
              status: dispatchRes.success ? "delivered" : "failed",
              channel: ch,
              recipient: r,
              topic,
              latencyMs: dispatchRes.latencyMs,
              error: dispatchRes.error || null,
              timestamp: new Date().toISOString(),
            }),
          }).catch(() => {});
        } catch {}
      }

      results.push(dispatchRes);
    }
  }

  const allSuccess = results.every((r) => r.success);
  res.status(allSuccess ? 200 : 207).json({
    success: allSuccess,
    deliveredCount: results.filter((r) => r.success).length,
    totalCount: results.length,
    results,
  });
});

// ─── Live Channel Health Checker ─────────────────────────────
app.get("/api/channels/health", async (_req: Request, res: Response) => {
  const statuses = await dispatcher.testAllChannels();
  res.json({ statuses });
});

app.post("/api/channels/:channel/test", requireAdminOrApiKey, async (req: Request, res: Response) => {
  const channel = req.params.channel as ChannelType;
  const status = await dispatcher.testChannel(channel);
  res.json(status);
});

// ─── Topic-Based Routing API ─────────────────────────────────
app.get("/api/routes", (_req: Request, res: Response) => {
  res.json({ routes: db.getRoutes() });
});

app.post("/api/routes", requireAdminOrApiKey, (req: Request, res: Response) => {
  const { topic, name, channels } = req.body;
  if (!topic || !name || !channels || !channels.length) {
    return res.status(400).json({ error: "topic, name, dan minimal 1 channel wajib diisi" });
  }
  const route = db.saveRoute(req.body);
  res.json({ success: true, route });
});

app.delete("/api/routes/:id", requireAdminOrApiKey, (req: Request, res: Response) => {
  const deleted = db.deleteRoute(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Topic route tidak ditemukan" });
  res.json({ success: true });
});

// ─── Analytics & Metrics API ─────────────────────────────────
app.get("/api/analytics", (_req: Request, res: Response) => {
  const analytics = db.getAnalytics();
  res.json(analytics);
});

// ─── Queue Manager API ───────────────────────────────────────
app.get("/api/queue", requireAdminOrApiKey, (_req: Request, res: Response) => {
  res.json({ queue: db.getQueue() });
});

app.delete("/api/queue/:id", requireAdminOrApiKey, (req: Request, res: Response) => {
  const deleted = db.deleteQueueItem(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Item antrean tidak ditemukan" });
  res.json({ success: true });
});

// ─── Settings & Channel Config ───────────────────────────────
app.get("/api/settings", (req: Request, res: Response) => {
  res.json({ settings: db.getSettings() });
});

app.post("/api/settings", requireAdminOrApiKey, (req: Request, res: Response) => {
  const updated = db.updateSettings(req.body);
  res.json({ success: true, settings: updated });
});

// ─── Templates API ───────────────────────────────────────────
app.get("/api/templates", (_req: Request, res: Response) => {
  res.json({ templates: db.getTemplates() });
});

app.post("/api/templates", requireAdminOrApiKey, (req: Request, res: Response) => {
  const tpl = db.saveTemplate(req.body);
  res.json({ success: true, template: tpl });
});

app.delete("/api/templates/:id", requireAdminOrApiKey, (req: Request, res: Response) => {
  const deleted = db.deleteTemplate(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Template not found" });
  res.json({ success: true });
});

// ─── Delivery Logs ───────────────────────────────────────────
app.get("/api/logs", (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 100;
  res.json({ logs: db.getLogs(limit) });
});

// ─── API Keys Manager ────────────────────────────────────────
app.get("/api/keys", requireAdminOrApiKey, (_req: Request, res: Response) => {
  res.json({ keys: db.getApiKeys() });
});

app.post("/api/keys", requireAdminOrApiKey, (req: Request, res: Response) => {
  const { name, clientSlug } = req.body;
  if (!name || !clientSlug) {
    return res.status(400).json({ error: "name and clientSlug are required" });
  }
  const key = db.createApiKey(name, clientSlug);
  res.status(201).json({ key });
});

app.delete("/api/keys/:id", requireAdminOrApiKey, (req: Request, res: Response) => {
  const deleted = db.deleteApiKey(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Key not found" });
  res.json({ success: true });
});

// ─── Push Subscriptions ──────────────────────────────────────
app.post("/api/webpush/subscribe", (req: Request, res: Response) => {
  const { endpoint, keys, userTag } = req.body;
  if (!endpoint || !keys) {
    return res.status(400).json({ error: "Invalid subscription data" });
  }
  const sub = db.addPushSubscription({ endpoint, keys, userTag });
  res.status(201).json({ success: true, subscription: sub });
});

// Angular catch-all fallback
if (fs.existsSync(FRONTEND_DIST)) {
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 [NotifyBridge] Hub running on http://localhost:${PORT}`);
  console.log(`🔐 [AuthHub] Protected with SSO (AuthHub URL: ${AUTHHUB_URL})`);
  // Start background queue & scheduler
  queueRunner.start();
});
