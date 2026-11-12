import { db } from "./db.js";
import { dispatcher } from "./dispatcher.js";
import type { QueueItem, ChannelType, AttachmentItem } from "./types.js";

// Per-channel rate limits (minimum ms between dispatches to prevent rate-limit bans)
const CHANNEL_MIN_INTERVAL_MS: Record<ChannelType, number> = {
  whatsapp: 200,   // ~5 msg/s
  email: 100,      // ~10 msg/s
  telegram: 70,    // ~15 msg/s
  discord: 200,    // ~5 msg/s
  webpush: 50,     // ~20 msg/s
  webhook: 50,     // ~20 msg/s
};

// Exponential backoff delays in ms: attempt 1 -> 2s, attempt 2 -> 5s, attempt 3 -> 10s
const RETRY_BACKOFF_MS = [2000, 5000, 10000];

export class QueueRunner {
  private isRunning = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private lastDispatchTimes: Record<string, number> = {};

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("⚡ [NotifyBridge Queue] Smart Queue Worker & Scheduler started");
    this.intervalTimer = setInterval(() => {
      this.tick().catch((err) => console.error("Error in queue runner tick:", err));
    }, 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Enqueue a notification with optional scheduling or delay
   */
  public enqueueItem(params: {
    channel: ChannelType;
    recipient: string;
    title?: string;
    message: string;
    attachments?: AttachmentItem[];
    clientApp?: string;
    topic?: string;
    callbackUrl?: string;
    sendAt?: string;
    delaySeconds?: number;
    maxAttempts?: number;
  }): QueueItem {
    const now = Date.now();
    let scheduledFor = now;

    if (params.sendAt) {
      const parsed = new Date(params.sendAt).getTime();
      if (!isNaN(parsed) && parsed > now) {
        scheduledFor = parsed;
      }
    } else if (params.delaySeconds && params.delaySeconds > 0) {
      scheduledFor = now + params.delaySeconds * 1000;
    }

    return db.enqueue({
      channel: params.channel,
      recipient: params.recipient,
      title: params.title,
      message: params.message,
      attachments: params.attachments,
      clientApp: params.clientApp,
      topic: params.topic,
      callbackUrl: params.callbackUrl,
      maxAttempts: params.maxAttempts || 3,
      scheduledFor,
      nextAttemptAt: scheduledFor,
    });
  }

  /**
   * Main queue processing tick
   */
  private async tick() {
    const now = Date.now();
    const queue = db.getQueue();

    // Find pending items due for processing
    const readyItems = queue.filter(
      (item) => item.status === "queued" && item.nextAttemptAt <= now
    );

    if (readyItems.length === 0) return;

    for (const item of readyItems) {
      // Check rate limit for channel
      const minInterval = CHANNEL_MIN_INTERVAL_MS[item.channel] || 100;
      const lastTime = this.lastDispatchTimes[item.channel] || 0;
      if (now - lastTime < minInterval) {
        // Skip for now, will pick up on next tick
        continue;
      }

      this.lastDispatchTimes[item.channel] = now;
      await this.processItem(item);
    }

    // Cleanup old items (every ~100 ticks)
    if (Math.random() < 0.05) {
      db.cleanupCompletedQueue();
    }
  }

  /**
   * Process individual queue item
   */
  private async processItem(item: QueueItem) {
    db.updateQueueItem(item.id, { status: "processing" });

    try {
      const dispatchRes = await dispatcher.dispatch({
        channel: item.channel,
        recipient: item.recipient,
        title: item.title,
        message: item.message,
        attachments: item.attachments,
        clientApp: item.clientApp ? `${item.clientApp} (Queue)` : "Queue Runner",
        topic: item.topic,
      });

      if (dispatchRes.success) {
        db.updateQueueItem(item.id, {
          status: "delivered",
          attempts: item.attempts + 1,
          lastError: undefined,
        });

        // Fire callback webhook if registered
        this.fireCallback(item, "delivered");
      } else {
        await this.handleFailure(item, dispatchRes.error || "Dispatch failed");
      }
    } catch (err: any) {
      await this.handleFailure(item, err.message || "Unexpected exception during dispatch");
    }
  }

  /**
   * Handle failed attempt with exponential backoff
   */
  private async handleFailure(item: QueueItem, errorMessage: string) {
    const newAttempts = item.attempts + 1;

    if (newAttempts < item.maxAttempts) {
      const backoffIndex = Math.min(newAttempts - 1, RETRY_BACKOFF_MS.length - 1);
      const backoffMs = RETRY_BACKOFF_MS[backoffIndex];
      const nextAttemptAt = Date.now() + backoffMs;

      console.warn(
        `⚠️ [NotifyBridge Queue] ${item.channel} dispatch failed for ${item.recipient} (Attempt ${newAttempts}/${item.maxAttempts}). Retrying in ${backoffMs / 1000}s. Error: ${errorMessage}`
      );

      db.updateQueueItem(item.id, {
        status: "queued",
        attempts: newAttempts,
        nextAttemptAt,
        lastError: errorMessage,
      });
    } else {
      console.error(
        `❌ [NotifyBridge Queue] ${item.channel} dispatch completely failed after ${newAttempts} attempts for ${item.recipient}. Error: ${errorMessage}`
      );

      db.updateQueueItem(item.id, {
        status: "failed",
        attempts: newAttempts,
        lastError: errorMessage,
      });

      // Fire callback webhook on terminal failure
      this.fireCallback(item, "failed", errorMessage);
    }
  }

  /**
   * Fire Delivery Callback Webhook
   */
  private async fireCallback(item: QueueItem, status: "delivered" | "failed", error?: string) {
    if (!item.callbackUrl || !item.callbackUrl.startsWith("http")) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      await fetch(item.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "notification.status",
          queueId: item.id,
          status,
          channel: item.channel,
          recipient: item.recipient,
          topic: item.topic,
          attempts: item.attempts + 1,
          error: error || item.lastError || null,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (cbErr: any) {
      console.warn(`Failed to fire callback URL ${item.callbackUrl}:`, cbErr.message);
    }
  }
}

export const queueRunner = new QueueRunner();
