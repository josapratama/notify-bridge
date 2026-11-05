import dotenv from "dotenv";

dotenv.config();

export const PORT = Number(process.env.PORT) || 4200;

// AuthHub SSO & OAuth2 Config
export const AUTHHUB_URL = (process.env.AUTHHUB_URL || "https://auth.josapratama.com").replace(/\/$/, "");
export const AUTHHUB_CLIENT_ID = process.env.AUTHHUB_CLIENT_ID || "ah_client_notifybridge_4e5f6a";
export const AUTHHUB_CLIENT_SECRET = process.env.AUTHHUB_CLIENT_SECRET || "ah_secret_notifybridge_9f8e7d6c5b4a3f2e1d0c9b";
export const AUTHHUB_REDIRECT_URI = process.env.AUTHHUB_REDIRECT_URI || "http://localhost:4200/auth/callback";

// Channels Default Configuration
export const WABRIDGE_URL = (process.env.WABRIDGE_URL || "http://localhost:8080").replace(/\/$/, "");
export const WABRIDGE_TOKEN = process.env.WABRIDGE_TOKEN || "";

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

// SMTP Config
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
export const SMTP_SECURE = process.env.SMTP_SECURE === "true";
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM = process.env.SMTP_FROM || "NotifyBridge <noreply@josapratama.com>";

// Web Push VAPID Keys
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BE_EXAMPLE_VAPID_PUBLIC_KEY_FOR_LOCAL_DEV";
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "EXAMPLE_VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@josapratama.com";
