export type ChannelType = "whatsapp" | "email" | "telegram" | "discord" | "webpush" | "webhook";
export type NotificationStatus = "queued" | "sent" | "delivered" | "failed";

export interface AttachmentItem {
  filename?: string;
  url?: string;
  contentBase64?: string;
  contentType?: string;
}

export interface ChannelSettings {
  whatsapp: {
    enabled: boolean;
    gatewayUrl: string;
    apiKey: string;
  };
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    defaultChatId?: string;
  };
  discord: {
    enabled: boolean;
    webhookUrl: string;
  };
  webpush: {
    enabled: boolean;
    publicKey: string;
    privateKey: string;
    subject: string;
  };
}

export interface NotificationTemplate {
  id: string;
  name: string;
  slug: string;
  channels: ChannelType[];
  titleTemplate?: string;
  bodyTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  channel: ChannelType;
  recipient: string;
  subject?: string;
  body: string;
  status: NotificationStatus;
  responsePayload?: any;
  error?: string;
  latencyMs: number;
  clientApp?: string;
  createdAt: string;
  attachmentsCount?: number;
  topic?: string;
  retryCount?: number;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  clientSlug: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface PushSubscriptionItem {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userTag?: string;
  createdAt: string;
}

export interface TopicRoute {
  id: string;
  topic: string;
  name: string;
  description?: string;
  channels: ChannelType[];
  defaultRecipients?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  channel: ChannelType;
  recipient: string;
  title?: string;
  message: string;
  attachments?: AttachmentItem[];
  clientApp?: string;
  topic?: string;
  callbackUrl?: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor: number;
  nextAttemptAt: number;
  status: "queued" | "processing" | "delivered" | "failed";
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelHealthStatus {
  channel: ChannelType;
  enabled: boolean;
  online: boolean;
  latencyMs: number;
  message: string;
  testedAt: string;
}

export interface NotifyBridgeStore {
  settings: ChannelSettings;
  templates: NotificationTemplate[];
  logs: NotificationLog[];
  apiKeys: ApiKeyItem[];
  pushSubscriptions: PushSubscriptionItem[];
  routes: TopicRoute[];
  queue: QueueItem[];
}
