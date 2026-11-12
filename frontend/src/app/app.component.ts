import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type ChannelType = 'whatsapp' | 'email' | 'telegram' | 'discord' | 'webpush' | 'webhook';

export interface AttachmentItem {
  filename?: string;
  url?: string;
  contentBase64?: string;
  contentType?: string;
}

interface ChannelSettings {
  whatsapp: { enabled: boolean; gatewayUrl: string; apiKey: string };
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  telegram: { enabled: boolean; botToken: string; defaultChatId?: string };
  discord: { enabled: boolean; webhookUrl: string };
  webpush: { enabled: boolean; publicKey: string; privateKey: string; subject: string };
}

interface NotificationTemplate {
  id: string;
  name: string;
  slug: string;
  channels: ChannelType[];
  titleTemplate?: string;
  bodyTemplate: string;
}

interface NotificationLog {
  id: string;
  channel: ChannelType;
  recipient: string;
  subject?: string;
  body: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  responsePayload?: any;
  error?: string;
  latencyMs: number;
  clientApp?: string;
  createdAt: string;
  attachmentsCount?: number;
  topic?: string;
}

interface TopicRoute {
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

interface QueueItem {
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
  status: 'queued' | 'processing' | 'delivered' | 'failed';
  lastError?: string;
  createdAt: string;
}

interface ChannelHealthStatus {
  channel: ChannelType;
  enabled: boolean;
  online: boolean;
  latencyMs: number;
  message: string;
  testedAt: string;
}

interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  clientSlug: string;
  createdAt: string;
}

interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  appRole: string;
  globalRole: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  title = 'NotifyBridge';
  activeTab: 'sandbox' | 'logs' | 'templates' | 'channels' | 'routing' | 'keys' = 'sandbox';

  // Toast
  toast: { text: string; type: 'success' | 'error' | 'info' } | null = null;

  // AuthHub State
  currentUser: AuthUser | null = null;
  authToken: string = '';
  authConfig: any = null;
  showLoginModal: boolean = false;

  // Sandbox Form
  sandboxForm = {
    channel: 'whatsapp' as ChannelType,
    recipient: '',
    title: '',
    message: 'Halo, ini adalah pesan uji coba dari NotifyBridge Universal Gateway! 🚀',
    templateSlug: '',
    topic: '',
    sendMode: 'now' as 'now' | 'scheduled' | 'delayed',
    sendAt: '',
    delaySeconds: 10,
    callbackUrl: '',
    fallbackChannels: [] as ChannelType[],
    attachments: [] as AttachmentItem[],
    newAttUrl: '',
    newAttFilename: '',
  };
  isSending = false;
  lastSendResult: any = null;

  // Data
  logs: NotificationLog[] = [];
  templates: NotificationTemplate[] = [];
  routes: TopicRoute[] = [];
  queue: QueueItem[] = [];
  settings: ChannelSettings = {
    whatsapp: { enabled: true, gatewayUrl: 'http://localhost:8080', apiKey: '' },
    email: {
      enabled: true,
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: '',
      pass: '',
      from: 'NotifyBridge <noreply@josapratama.com>',
    },
    telegram: { enabled: true, botToken: '', defaultChatId: '' },
    discord: { enabled: true, webhookUrl: '' },
    webpush: { enabled: true, publicKey: '', privateKey: '', subject: 'mailto:admin@josapratama.com' },
  };
  apiKeys: ApiKeyItem[] = [];
  availableChannels: ChannelType[] = ['whatsapp', 'email', 'telegram', 'discord', 'webpush', 'webhook'];

  // Health checks
  channelHealth: Record<string, ChannelHealthStatus> = {};
  isCheckingAllHealth = false;
  testingChannel: string | null = null;

  // Analytics
  analytics: any = null;

  // Template Form Modal
  showTplModal = false;
  editingTemplate: any = { name: '', slug: '', channels: ['whatsapp'], titleTemplate: '', bodyTemplate: '' };

  // Topic Route Form Modal
  showRouteModal = false;
  editingRoute: any = {
    id: '',
    topic: '',
    name: '',
    description: '',
    channels: ['telegram', 'discord'] as ChannelType[],
    enabled: true,
    defaultRecipientText: '',
  };

  // New API Key Form
  showKeyModal = false;
  newKeyForm = { name: '', clientSlug: '' };

  get canEdit(): boolean {
    if (!this.currentUser) return false;
    const r = this.currentUser.appRole;
    return this.currentUser.globalRole === 'superadmin' || r === 'superadmin' || r === 'admin' || r === 'editor';
  }

  get isAdmin(): boolean {
    if (!this.currentUser) return false;
    const r = this.currentUser.appRole;
    return this.currentUser.globalRole === 'superadmin' || r === 'superadmin' || r === 'admin';
  }

  ngOnInit() {
    this.authToken = localStorage.getItem('nb_auth_token') || '';
    this.checkOAuthCallback();
    this.loadAuthConfig();
    this.loadLogs();
    this.loadTemplates();
    this.loadSettings();
    this.loadApiKeys();
    this.loadRoutes();
    this.loadAnalytics();
    this.loadQueue();
    this.checkAllHealth();
  }

  showToastMsg(text: string, type: 'success' | 'error' | 'info' = 'info') {
    this.toast = { text, type };
    setTimeout(() => {
      if (this.toast?.text === text) this.toast = null;
    }, 4000);
  }

  async loadAuthConfig() {
    try {
      const res = await fetch('/api/auth/config');
      if (res.ok) this.authConfig = await res.json();
    } catch (e) {
      console.warn('Could not load auth config', e);
    }
  }

  async checkOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      try {
        const redirectUri = `${window.location.origin}/auth/callback`;
        const res = await fetch('/api/auth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirectUri }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
          this.authToken = data.token;
          localStorage.setItem('nb_auth_token', data.token);
          this.currentUser = data.user;
          this.showToastMsg(`Selamat datang, ${data.user.name}! Login via AuthHub SSO berhasil.`, 'success');
        } else {
          this.showToastMsg(data.error || 'Gagal login SSO AuthHub', 'error');
        }
      } catch (e) {
        this.showToastMsg('Kesalahan jaringan saat verifikasi SSO', 'error');
      } finally {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else if (this.authToken) {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${this.authToken}` },
        });
        const data = await res.json();
        if (data.authenticated && data.user) {
          this.currentUser = data.user;
        } else {
          this.authToken = '';
          localStorage.removeItem('nb_auth_token');
        }
      } catch {
        this.authToken = '';
      }
    }
  }

  loginWithAuthHub() {
    if (this.authConfig?.ssoLoginUrl) {
      const ssoUrl = new URL(this.authConfig.ssoLoginUrl);
      ssoUrl.searchParams.set('redirect_uri', `${window.location.origin}/auth/callback`);
      window.location.href = ssoUrl.toString();
    } else {
      window.location.href = `https://auth.josapratama.com/?oauth=1&client_id=ah_client_notifybridge_4e5f6a&redirect_uri=${encodeURIComponent(
        window.location.origin + '/auth/callback'
      )}`;
    }
  }

  logout() {
    localStorage.removeItem('nb_auth_token');
    this.authToken = '';
    this.currentUser = null;
    this.showToastMsg('Anda telah keluar dari NotifyBridge.', 'info');
  }

  getAuthHeaders(): HeadersInit {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  // ─── Data Loaders ──────────────────────────────────────────
  async loadLogs() {
    try {
      const res = await fetch('/api/logs?limit=50', { headers: this.getAuthHeaders() });
      const data = await res.json();
      this.logs = data.logs || [];
    } catch (e) {
      console.error(e);
    }
  }

  async loadTemplates() {
    try {
      const res = await fetch('/api/templates', { headers: this.getAuthHeaders() });
      const data = await res.json();
      this.templates = data.templates || [];
    } catch (e) {
      console.error(e);
    }
  }

  async loadSettings() {
    try {
      const res = await fetch('/api/settings', { headers: this.getAuthHeaders() });
      const data = await res.json();
      if (data.settings) this.settings = data.settings;
    } catch (e) {
      console.error(e);
    }
  }

  async loadApiKeys() {
    try {
      const res = await fetch('/api/keys', { headers: this.getAuthHeaders() });
      const data = await res.json();
      this.apiKeys = data.keys || [];
    } catch (e) {
      console.error(e);
    }
  }

  async loadRoutes() {
    try {
      const res = await fetch('/api/routes', { headers: this.getAuthHeaders() });
      const data = await res.json();
      this.routes = data.routes || [];
    } catch (e) {
      console.error(e);
    }
  }

  async loadAnalytics() {
    try {
      const res = await fetch('/api/analytics', { headers: this.getAuthHeaders() });
      if (res.ok) {
        this.analytics = await res.json();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async loadQueue() {
    try {
      const res = await fetch('/api/queue', { headers: this.getAuthHeaders() });
      const data = await res.json();
      this.queue = data.queue || [];
    } catch (e) {
      console.error(e);
    }
  }

  // ─── Health Checks ─────────────────────────────────────────
  async checkAllHealth() {
    this.isCheckingAllHealth = true;
    try {
      const res = await fetch('/api/channels/health');
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, ChannelHealthStatus> = {};
        for (const st of data.statuses || []) {
          map[st.channel] = st;
        }
        this.channelHealth = map;
      }
    } catch (e) {
      console.warn('Health check failed', e);
    } finally {
      this.isCheckingAllHealth = false;
    }
  }

  async testSingleChannel(channel: ChannelType) {
    this.testingChannel = channel;
    try {
      const res = await fetch(`/api/channels/${channel}/test`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
      });
      const data = await res.json();
      this.channelHealth[channel] = data;
      if (data.online) {
        this.showToastMsg(`Saluran ${channel.toUpperCase()} ONLINE (${data.latencyMs}ms)`, 'success');
      } else {
        this.showToastMsg(`Saluran ${channel.toUpperCase()}: ${data.message}`, 'error');
      }
    } catch (e: any) {
      this.showToastMsg(`Gagal menguji ${channel}: ${e.message}`, 'error');
    } finally {
      this.testingChannel = null;
    }
  }

  // ─── Sandbox Attachments ───────────────────────────────────
  addAttachment() {
    if (!this.sandboxForm.newAttUrl) return;
    const url = this.sandboxForm.newAttUrl.trim();
    let filename = this.sandboxForm.newAttFilename.trim();
    if (!filename) {
      filename = url.split('/').pop()?.split('?')[0] || 'attachment.pdf';
    }
    const isImage = /\.(jpe?g|png|gif|webp)$/i.test(url);
    const contentType = isImage ? 'image/jpeg' : 'application/pdf';

    this.sandboxForm.attachments.push({
      url,
      filename,
      contentType,
    });
    this.sandboxForm.newAttUrl = '';
    this.sandboxForm.newAttFilename = '';
  }

  removeAttachment(index: number) {
    this.sandboxForm.attachments.splice(index, 1);
  }

  applyTopic(route: TopicRoute) {
    this.sandboxForm.topic = route.topic;
    if (route.channels && route.channels.length > 0) {
      this.sandboxForm.channel = route.channels[0];
    }
    this.showToastMsg(`Topic '${route.name}' diterapkan ke sandbox!`, 'info');
  }

  // ─── Send Notification ──────────────────────────────────────
  async sendTestNotification() {
    if (!this.sandboxForm.recipient && !this.sandboxForm.topic) {
      this.showToastMsg('Harap masukkan nomor / email tujuan atau pilih Topic Routing.', 'error');
      return;
    }

    this.isSending = true;
    this.lastSendResult = null;

    try {
      const body: Record<string, any> = {
        channel: this.sandboxForm.channel,
        recipient: this.sandboxForm.recipient,
        title: this.sandboxForm.title || 'NotifyBridge Test Alert',
        message: this.sandboxForm.message,
        template: this.sandboxForm.templateSlug || undefined,
        topic: this.sandboxForm.topic || undefined,
        attachments: this.sandboxForm.attachments.length > 0 ? this.sandboxForm.attachments : undefined,
        callbackUrl: this.sandboxForm.callbackUrl || undefined,
      };

      if (this.sandboxForm.sendMode === 'delayed') {
        body['delaySeconds'] = Number(this.sandboxForm.delaySeconds) || 10;
      } else if (this.sandboxForm.sendMode === 'scheduled') {
        body['sendAt'] = this.sandboxForm.sendAt;
      }

      const res = await fetch('/api/v1/send', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      this.lastSendResult = data;

      if (res.status === 202) {
        this.showToastMsg(`Notifikasi dijadwalkan & masuk antrean smart queue! ⏳`, 'info');
        this.loadQueue();
        this.loadAnalytics();
      } else if (res.ok && data.success) {
        this.showToastMsg(`Berhasil dikirim via ${this.sandboxForm.channel.toUpperCase()}! 🚀`, 'success');
        this.loadLogs();
        this.loadAnalytics();
      } else {
        this.showToastMsg(data.error || 'Pengiriman gagal atau sebagian gagal', 'error');
      }
    } catch (e: any) {
      this.showToastMsg('Kesalahan jaringan: ' + e.message, 'error');
    } finally {
      this.isSending = false;
    }
  }

  // ─── Topic Route Manager ───────────────────────────────────
  openNewRouteModal() {
    this.editingRoute = {
      id: '',
      topic: '',
      name: '',
      description: '',
      channels: ['telegram', 'discord'],
      enabled: true,
      defaultRecipientText: '',
    };
    this.showRouteModal = true;
  }

  editRoute(route: TopicRoute) {
    const recipientsStr = route.defaultRecipients
      ? Object.entries(route.defaultRecipients)
          .map(([ch, rec]) => `${ch}:${rec}`)
          .join(', ')
      : '';

    this.editingRoute = {
      id: route.id,
      topic: route.topic,
      name: route.name,
      description: route.description || '',
      channels: [...route.channels],
      enabled: route.enabled,
      defaultRecipientText: recipientsStr,
    };
    this.showRouteModal = true;
  }

  toggleRouteChannel(channel: ChannelType | string) {
    const ch = channel as ChannelType;
    const idx = this.editingRoute.channels.indexOf(ch);
    if (idx > -1) {
      if (this.editingRoute.channels.length > 1) {
        this.editingRoute.channels.splice(idx, 1);
      }
    } else {
      this.editingRoute.channels.push(ch);
    }
  }

  async saveRoute() {
    if (!this.editingRoute.topic || !this.editingRoute.name) {
      this.showToastMsg('Topic slug dan Nama rute wajib diisi', 'error');
      return;
    }

    // Parse recipients
    const defaultRecipients: Record<string, string> = {};
    if (this.editingRoute.defaultRecipientText) {
      const parts = this.editingRoute.defaultRecipientText.split(',');
      for (const p of parts) {
        const [ch, rec] = p.split(':').map((s: string) => s.trim());
        if (ch && rec) defaultRecipients[ch] = rec;
      }
    }

    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          id: this.editingRoute.id || undefined,
          topic: this.editingRoute.topic,
          name: this.editingRoute.name,
          description: this.editingRoute.description,
          channels: this.editingRoute.channels,
          defaultRecipients,
          enabled: this.editingRoute.enabled,
        }),
      });

      if (res.ok) {
        this.showRouteModal = false;
        this.loadRoutes();
        this.showToastMsg('Topic route berhasil disimpan!', 'success');
      } else {
        const data = await res.json();
        this.showToastMsg(data.error || 'Gagal menyimpan topic route', 'error');
      }
    } catch (e: any) {
      this.showToastMsg('Kesalahan server: ' + e.message, 'error');
    }
  }

  async deleteRoute(id: string) {
    if (!confirm('Hapus konfigurasi topic routing ini?')) return;
    try {
      await fetch(`/api/routes/${id}`, { method: 'DELETE', headers: this.getAuthHeaders() });
      this.loadRoutes();
      this.showToastMsg('Topic route berhasil dihapus.', 'info');
    } catch (e) {
      console.error(e);
    }
  }

  async toggleRouteStatus(route: TopicRoute) {
    try {
      await fetch('/api/routes', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          ...route,
          enabled: !route.enabled,
        }),
      });
      this.loadRoutes();
      this.showToastMsg(`Route '${route.name}' ${!route.enabled ? 'diaktifkan' : 'dinonaktifkan'}`, 'info');
    } catch (e) {
      console.error(e);
    }
  }

  // ─── Queue Manager ─────────────────────────────────────────
  async deleteQueueItem(id: string) {
    try {
      await fetch(`/api/queue/${id}`, { method: 'DELETE', headers: this.getAuthHeaders() });
      this.loadQueue();
      this.showToastMsg('Item antrean berhasil dibatalkan/dihapus.', 'info');
    } catch (e) {
      console.error(e);
    }
  }

  // ─── Settings ──────────────────────────────────────────────
  async saveSettings() {
    if (!this.canEdit) {
      this.showLoginModal = true;
      return;
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(this.settings),
      });
      if (res.ok) {
        this.showToastMsg('Konfigurasi saluran berhasil disimpan!', 'success');
        this.checkAllHealth();
      } else {
        this.showToastMsg('Gagal menyimpan konfigurasi saluran.', 'error');
      }
    } catch (e) {
      this.showToastMsg('Kesalahan server', 'error');
    }
  }

  // ─── API Keys ──────────────────────────────────────────────
  async createApiKey() {
    if (!this.newKeyForm.name || !this.newKeyForm.clientSlug) return;
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(this.newKeyForm),
      });
      if (res.ok) {
        this.showKeyModal = false;
        this.newKeyForm = { name: '', clientSlug: '' };
        this.loadApiKeys();
        this.showToastMsg('API Key baru berhasil dibuat!', 'success');
      }
    } catch (e) {
      console.error(e);
    }
  }

  async deleteApiKey(id: string) {
    if (!confirm('Hapus API Key ini? Layanan yang menggunakan key ini tidak dapat mengirim notifikasi lagi.')) return;
    try {
      await fetch(`/api/keys/${id}`, { method: 'DELETE', headers: this.getAuthHeaders() });
      this.loadApiKeys();
      this.showToastMsg('API Key dihapus.', 'info');
    } catch (e) {
      console.error(e);
    }
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    this.showToastMsg('Teks disalin ke clipboard!', 'info');
  }
}
