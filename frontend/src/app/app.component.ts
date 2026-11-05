import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type ChannelType = 'whatsapp' | 'email' | 'telegram' | 'discord' | 'webpush' | 'webhook';

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
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'NotifyBridge';
  activeTab: 'sandbox' | 'logs' | 'templates' | 'channels' | 'keys' = 'sandbox';

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
    fallbackChannels: [] as ChannelType[],
  };
  isSending = false;
  lastSendResult: any = null;

  // Data
  logs: NotificationLog[] = [];
  templates: NotificationTemplate[] = [];
  settings: ChannelSettings = {
    whatsapp: { enabled: true, gatewayUrl: 'http://localhost:8080', apiKey: '' },
    email: { enabled: true, host: 'smtp.gmail.com', port: 587, secure: false, user: '', pass: '', from: 'NotifyBridge <noreply@josapratama.com>' },
    telegram: { enabled: true, botToken: '', defaultChatId: '' },
    discord: { enabled: true, webhookUrl: '' },
    webpush: { enabled: true, publicKey: '', privateKey: '', subject: 'mailto:admin@josapratama.com' },
  };
  apiKeys: ApiKeyItem[] = [];

  // Template Form Modal
  showTplModal = false;
  editingTemplate: any = { name: '', slug: '', channels: ['whatsapp'], titleTemplate: '', bodyTemplate: '' };

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
      window.location.href = `https://auth.josapratama.com/?oauth=1&client_id=ah_client_notifybridge_4e5f6a&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}`;
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

  async sendTestNotification() {
    if (!this.sandboxForm.recipient) {
      this.showToastMsg('Harap masukkan nomor / email / ID tujuan penerima.', 'error');
      return;
    }

    this.isSending = true;
    this.lastSendResult = null;

    try {
      const res = await fetch('/api/v1/send', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          channel: this.sandboxForm.channel,
          recipient: this.sandboxForm.recipient,
          title: this.sandboxForm.title || 'NotifyBridge Test Alert',
          message: this.sandboxForm.message,
          template: this.sandboxForm.templateSlug || undefined,
        }),
      });

      const data = await res.json();
      this.lastSendResult = data;

      if (res.ok && data.success) {
        this.showToastMsg(`Berhasil dikirim via ${this.sandboxForm.channel.toUpperCase()}! 🚀`, 'success');
        this.loadLogs();
      } else {
        this.showToastMsg(data.error || 'Pengiriman gagal atau sebagian gagal', 'error');
      }
    } catch (e: any) {
      this.showToastMsg('Kesalahan jaringan: ' + e.message, 'error');
    } finally {
      this.isSending = false;
    }
  }

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
      } else {
        this.showToastMsg('Gagal menyimpan konfigurasi saluran.', 'error');
      }
    } catch (e) {
      this.showToastMsg('Kesalahan server', 'error');
    }
  }

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
