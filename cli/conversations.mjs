// conversations.mjs — единая модель «разговоров» для web-чата и Telegram (синхронизация).
// Роль-разговоры (адъютант + министры) имеют КАНОНИЧЕСКИЙ id, общий для обоих клиентов:
// одна claude-сессия + одна история chat_message → начал на компьютере, продолжил в телефоне.
// Свободные веб-треды (произвольные темы) остаются web-only со своими UUID.

export const MINISTER_ROLES = ["health", "mind", "finance", "work", "learning", "relationships", "growth", "lifestyle", "admin"];

const TITLES = {
  adjutant: "🎖 Адъютант",
  health: "🏥 Здоровье", mind: "🧠 Разум", finance: "💰 Финансы", work: "💼 Работа",
  learning: "📚 Обучение", relationships: "❤️ Отношения", growth: "🌱 Рост",
  lifestyle: "🏡 Быт", admin: "📋 Дела",
};

/** Канонический thread_id роль-разговора (общий web↔TG). role="adjutant"|министр. */
export function convId(role) {
  return `conv-${role}`;
}

/** true, если thread_id — общий роль-разговор (а не свободный веб-тред). */
export function isSharedConv(threadId) {
  return typeof threadId === "string" && threadId.startsWith("conv-");
}

/** Роль из канонического id (или null). */
export function roleOfConv(threadId) {
  return isSharedConv(threadId) ? threadId.slice("conv-".length) : null;
}

export function convTitle(role) {
  return TITLES[role] || role;
}

/** Полный список общих разговоров (для посева/списка тредов). */
export function allSharedConvs() {
  return ["adjutant", ...MINISTER_ROLES].map((role) => ({
    id: convId(role),
    role,
    title: convTitle(role),
    shared: true,
  }));
}
