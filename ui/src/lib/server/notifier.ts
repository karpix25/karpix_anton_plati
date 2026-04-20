import pool from "@/lib/db";

const PAYMENT_ERROR_PATTERNS = [
  /payment_required/i,
  /paid_plan_required/i,
  /insufficient\s+(funds|balance|credits?)/i,
  /credits?\s+insufficient/i,
  /not\s+enough\s+(credit|balance|credits?)/i,
  /quota\s+exceeded/i,
  /out\s+of\s+credits?/i,
  /credits?\s+exhausted/i,
  /subscription|plan\s+required|upgrade/i,
  /authorization\s+failed/i,
  /unauthorized/i,
  /\b401\b/i,
  /\b402\b/i,
];

const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const lastAlerts = new Map<string, number>();

function isPaymentIssue(message: string): boolean {
  return PAYMENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function parseTelegramIds(rawValue: string): number[] {
  return rawValue
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => parseInt(v, 10))
    .filter((v) => !isNaN(v) && v > 0);
}

async function sendTelegramMessage(chatId: string | number, text: string, threadId?: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;
  if (!token) {
    console.warn("[Notifier] Telegram token missing. Set TELEGRAM_BOT_TOKEN.");
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        message_thread_id: threadId,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Notifier] Failed to send Telegram message to ${chatId}: ${err}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[Notifier] Error sending Telegram message:`, error);
    return false;
  }
}

export async function notifyServicePaymentIssue(clientId: number | null, provider: string, error: unknown): Promise<boolean> {
  const message = typeof error === "string" ? error : JSON.stringify(error);
  if (!isPaymentIssue(message)) {
    return false;
  }

  const normalizedProvider = (provider || "unknown").trim().toLowerCase();
  const normalizedClient = String(clientId || "global");
  const normalizedMessage = message.trim().toLowerCase();
  const alertKey = `${normalizedClient}:${normalizedProvider}:${normalizedMessage.slice(0, 200)}`;

  const now = Date.now();
  const lastAlert = lastAlerts.get(alertKey);
  if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) {
    return false;
  }

  const shortMessage = message.length > 420 ? `${message.slice(0, 420)}...` : message;
  const text = `🚨 [SERVICE ERROR] ${provider}\nПохоже, закончился баланс или достигнут лимит.\nДетали: ${shortMessage}`;

  let sentSuccessful = false;

  // 1. Notify main admin chat
  const mainChatId = process.env.TELEGRAM_CHAT_ID;
  if (mainChatId) {
    const ok = await sendTelegramMessage(mainChatId, text);
    if (ok) sentSuccessful = true;
  }

  // 2. Notify super admins individually
  const superAdminIds = [
    ...parseTelegramIds(process.env.TELEGRAM_SUPER_ADMIN_IDS || ""),
    ...parseTelegramIds(process.env.TELEGRAM_SUPER_ADMIN_ID || ""),
  ];
  for (const adminId of superAdminIds) {
    const ok = await sendTelegramMessage(adminId, text);
    if (ok) sentSuccessful = true;
  }

  // 3. Notify client topics if clientId is provided
  if (clientId) {
    try {
      const { rows } = await pool.query<{ topic_id: string }>(
        "SELECT topic_id FROM topic_configs WHERE client_id = $1",
        [clientId]
      );
      if (mainChatId && rows.length > 0) {
        for (const row of rows) {
          const topicId = parseInt(row.topic_id, 10);
          if (!isNaN(topicId) && topicId !== 0) {
            await sendTelegramMessage(mainChatId, text, topicId);
          }
        }
      }
    } catch (e) {
      console.error("[Notifier] Failed to fetch client topics:", e);
    }
  }

  lastAlerts.set(alertKey, now);
  return sentSuccessful;
}
