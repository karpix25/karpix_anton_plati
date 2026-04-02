import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export function statusText(hasScenario: boolean) {
  return hasScenario ? "проанализировано" : "без сценария";
}

export function patternTagStyle(patternType?: string) {
  const value = (patternType || "other").toLowerCase();

  if (value === "top_list") return "bg-sky-100 text-sky-700";
  if (value === "comparison") return "bg-violet-100 text-violet-700";
  if (value === "route_story") return "bg-amber-100 text-amber-800";
  if (value === "opinion_take") return "bg-rose-100 text-rose-700";
  if (value === "hidden_gems") return "bg-emerald-100 text-emerald-700";
  if (value === "mistakes") return "bg-red-100 text-red-700";
  if (value === "problem_solution") return "bg-indigo-100 text-indigo-700";
  if (value === "experience_review") return "bg-cyan-100 text-cyan-700";

  return "bg-slate-100 text-slate-700";
}

export function huntStageTagStyle(stage?: string) {
  const value = (stage || "").toLowerCase();

  if (value.includes("не осознает проблему")) return "bg-red-50 text-red-700 border border-red-100";
  if (value.includes("осознает проблему")) return "bg-orange-50 text-orange-700 border border-orange-100";
  if (value.includes("осознает решение")) return "bg-sky-50 text-sky-700 border border-sky-100";
  if (value.includes("сравнивает решения") || value.includes("осознает продукт")) return "bg-violet-50 text-violet-700 border border-violet-100";
  if (value.includes("готов купить") || value.includes("готов к покупке")) return "bg-emerald-50 text-emerald-700 border border-emerald-100";

  return "bg-zinc-50 text-zinc-600 border border-zinc-100";
}

const PLACEHOLDER_PREFIXES = [
  "не определ",
  "не указан",
  "не указана",
  "не указано",
  "undefined",
  "none",
  "null",
  "нет данных",
  "без данных",
];

export function normalizePlaceholderText(value?: string | null) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return undefined;
  }
  const lowered = normalized.toLowerCase();
  if (PLACEHOLDER_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return undefined;
  }
  return normalized;
}
