export type ChannelType = "whatsapp" | "email" | "telegram" | "discord" | "webpush" | "webhook";
export type NotificationStatus = "queued" | "sent" | "delivered" | "failed";

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

export interface NotifyBridgeStore {
  settings: ChannelSettings;
  templates: NotificationTemplate[];
  logs: NotificationLog[];
  apiKeys: ApiKeyItem[];
  pushSubscriptions: PushSubscriptionItem[];
}
