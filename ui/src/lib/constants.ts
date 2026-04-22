import { 
  type LucideIcon,
  LayoutDashboard, 
  FolderOpen, 
  FileText, 
  Zap, 
  Settings 
} from "lucide-react";
import { ClientSettings, Screen } from "@/types";

export const defaultSettings: ClientSettings = {
  brand_voice: "",
  product_info: "",
  target_audience: "",
  target_duration_seconds: 50,
  target_duration_min_seconds: 50,
  target_duration_max_seconds: 50,
  broll_interval_seconds: 3,
  broll_timing_mode: "coverage_percent",
  broll_pacing_profile: "balanced",
  broll_pause_threshold_seconds: 0.45,
  broll_coverage_percent: 35,
  broll_semantic_relevance_priority: "balanced",
  broll_product_clip_policy: "contextual",
  broll_generator_model: "veo3_lite",
  product_media_assets: [],
  product_keyword: "",
  product_video_url: "",
  tts_provider: "minimax",
  tts_voice_id: "Russian_Engaging_Podcaster_v1",
  elevenlabs_voice_id: "0ArNnoIAWKlT4WweaVMY",
  tts_silence_trim_min_duration_seconds: 0.35,
  tts_silence_trim_threshold_db: -45,
  tts_silence_trim_enabled: true,
  tts_sentence_trim_enabled: false,
  tts_sentence_trim_min_gap_seconds: 0.3,
  tts_sentence_trim_keep_gap_seconds: 0.1,
  tts_pronunciation_overrides: [],
  subtitles_enabled: false,
  subtitle_mode: "word_by_word",
  subtitle_style_preset: "classic",
  subtitle_font_family: "pt_sans",
  subtitle_font_color: "#FFFFFF",
  subtitle_font_weight: 700,
  subtitle_outline_color: "#111111",
  subtitle_outline_width: 3,
  subtitle_margin_v: 140,
  subtitle_margin_percent: 11,
  auto_generate_final_videos: false,
  daily_final_video_limit: 3,
  daily_final_video_count: 0,
  monthly_final_video_limit: 30,
  monthly_final_video_count: 0,
  open_final_video_jobs: 0,
  auto_generate: false,
  monthly_limit: 30,
};

export const navItems: Array<{
  id: Screen;
  icon: LucideIcon;
  label: string;
}> = [
  { id: "dashboard", icon: LayoutDashboard, label: "Панель" },
  { id: "references", icon: FolderOpen, label: "Библиотека (Темы и паттерны)" },
  { id: "scenarios", icon: FileText, label: "Сценарии" },
  { id: "generator", icon: Zap, label: "Генератор" },
  { id: "settings", icon: Settings, label: "Настройки" },
];

export const PATTERN_COLORS: Record<string, { base: string; light: string; text: string }> = {
  'how_to_list': { base: '#3b82f6', light: '#eff6ff', text: '#1e40af' }, // Blue
  'educational': { base: '#10b981', light: '#ecfdf5', text: '#065f46' }, // Emerald
  'case_study': { base: '#8b5cf6', light: '#f5f3ff', text: '#5b21b6' }, // Violet
  'solution_showcase': { base: '#f43f5e', light: '#fff1f2', text: '#9f1239' }, // Rose (Authority)
  'personal_story': { base: '#f59e0b', light: '#fffbeb', text: '#92400e' }, // Amber
  'myth_busting': { base: '#ef4444', light: '#fef2f2', text: '#991b1b' }, // Red
  'problem_solution': { base: '#6366f1', light: '#eef2ff', text: '#3730a3' }, // Indigo
  'comparison': { base: '#14b8a6', light: '#f0fdfa', text: '#134e4a' }, // Teal
  'opinion_take': { base: '#8b5cf6', light: '#f5f3ff', text: '#5b21b6' }, // Violet (Expertise)
  'other': { base: '#64748b', light: '#f8fafc', text: '#334155' }, // Slate
};

export const PATTERN_TRANSLATIONS: Record<string, string> = {
  'how_to_list': 'Пошаговый гайд',
  'educational': 'Обучающий лонгрид',
  'case_study': 'Разбор реального кейса',
  'solution_showcase': 'Презентация продукта',
  'personal_story': 'Личный опыт и инсайты',
  'myth_busting': 'Разрушение мифов',
  'problem_solution': 'Решение конкретной боли',
  'comparison': 'Честное сравнение',
  'opinion_take': 'Мнение эксперта',
  'other': 'Смешанный формат',
};

export const PATTERN_GROUPS: Record<string, string> = {
  'Opinion & Expertise': 'Мнение и Экспертиза',
  'Education & Value': 'Обучение и Польза',
  'Trust & Cases': 'Доверие и Кейсы',
  'Other': 'Разное'
};

export const PATTERN_TO_GROUP: Record<string, string> = {
  'opinion_take': 'Opinion & Expertise',
  'case_study': 'Trust & Cases',
  'solution_showcase': 'Trust & Cases',
  'educational': 'Education & Value',
  'how_to_list': 'Education & Value',
  'myth_busting': 'Education & Value',
  'personal_story': 'Trust & Cases',
  'problem_solution': 'Opinion & Expertise', // Solving problems is expert work
  'comparison': 'Opinion & Expertise',
  'other': 'Other',
};
