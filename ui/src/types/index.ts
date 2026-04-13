export interface Client {
  id: number;
  name: string;
  brand_voice?: string;
  product_info?: string;
  target_audience?: string;
  auto_generate?: boolean;
  monthly_limit?: number;
  target_duration_seconds?: number;
  target_duration_min_seconds?: number;
  target_duration_max_seconds?: number;
  broll_interval_seconds?: number;
  broll_timing_mode?: "fixed" | "semantic_pause" | "coverage_percent";
  broll_pacing_profile?: "calm" | "balanced" | "dynamic";
  broll_pause_threshold_seconds?: number;
  broll_coverage_percent?: number;
  broll_semantic_relevance_priority?: "precision" | "balanced" | "dynamic";
  broll_product_clip_policy?: "contextual" | "required";
  broll_generator_model?: "bytedance/v1-pro-text-to-video" | "bytedance/seedance-1.5-pro" | "grok-imagine/text-to-video" | "veo3" | "veo3_fast" | "veo3_lite";
  product_media_assets?: ProductMediaAsset[];
  product_keyword?: string;
  product_video_url?: string;
  tts_provider?: "minimax" | "elevenlabs";
  tts_voice_id?: string;
  elevenlabs_voice_id?: string;
  tts_silence_trim_min_duration_seconds?: number;
  tts_silence_trim_threshold_db?: number;
  tts_silence_trim_enabled?: boolean;
  tts_sentence_trim_enabled?: boolean;
  tts_sentence_trim_min_gap_seconds?: number;
  tts_sentence_trim_keep_gap_seconds?: number;
  tts_pronunciation_overrides?: TtsPronunciationOverride[];
  subtitles_enabled?: boolean;
  subtitle_mode?: "word_by_word" | "phrase_block";
  subtitle_style_preset?: "classic" | "impact" | "soft_box";
  subtitle_font_family?: "pt_sans" | "rubik" | "montserrat" | "oswald" | "noto_sans";
  subtitle_font_color?: string;
  subtitle_font_weight?: 400 | 700;
  subtitle_outline_color?: string;
  subtitle_outline_width?: number;
  subtitle_margin_v?: number;
  subtitle_margin_percent?: number;
  auto_generate_final_videos?: boolean;
  daily_final_video_limit?: number;
  daily_final_video_count?: number;
  monthly_final_video_limit?: number;
  monthly_final_video_count?: number;
  open_final_video_jobs?: number;
  learned_rules_scenario?: string;
  learned_rules_visual?: string;
  learned_rules_video?: string;
}

export type SubtitleMode = "word_by_word" | "phrase_block";
export type SubtitleStylePreset = "classic" | "impact" | "soft_box";
export type SubtitleFontFamily = "pt_sans" | "rubik" | "montserrat" | "oswald" | "noto_sans";
export type BackgroundAudioTag = "disturbing" | "inspiring" | "neutral" | "relax";

export interface TtsPronunciationOverride {
  search: string;
  replace: string;
  case_sensitive?: boolean;
  word_boundaries?: boolean;
}

export interface PatternFramework {
  pattern_type?: string;
  narrator_role?: string;
  hook_style?: string;
  core_thesis?: string;
  content_shape?: {
    format_type?: string;
    item_count?: number;
    sequence_logic?: string[];
  };
  integration_style?: {
    product_role?: string;
    placement?: string;
    tone?: string;
  };
  reusable_slots?: {
    replaceable_entities?: string[];
    fixed_elements?: string[];
    variation_axes?: string[];
  };
}

export interface ReferenceStrategy {
  topic_cluster?: string;
  topic_angle?: string;
  topic_family?: string;
  pain_point?: string;
  promise?: string;
  proof_type?: string;
  cta_type?: string;
}

export interface Reference {
  id: number;
  reels_url: string;
  transcript: string;
  created_at: string;
  niche: string;
  word_count?: number;
  duration_seconds?: number;
  audit_json?: {
    atoms?: {
      verbal_hook?: string;
    };
    hunt_ladder?: {
      stage?: string;
      reason?: string;
    };
    pattern_framework?: PatternFramework;
    reference_strategy?: ReferenceStrategy;
  };
  scenario_json?: {
    script?: string;
    pattern_type?: string;
  };
}

export interface TopicCard {
  id: number;
  topic_short?: string;
  topic_cluster?: string;
  topic_angle?: string;
  promise?: string;
  pain_point?: string;
  proof_type?: string;
  cta_type?: string;
}

export interface StructureCard {
  id: number;
  pattern_type?: string;
  narrator_role?: string;
  core_thesis?: string;
  format_type?: string;
  hook_style?: string;
  item_count?: number;
  sequence_logic?: string[];
  integration_style?: string;
  reusable_slots?: string[];
  forbidden_drifts?: string[];
}

export interface Settings {
  brand_voice: string;
  product_info: string;
  target_audience: string;
  target_duration_seconds: number;
  target_duration_min_seconds: number;
  target_duration_max_seconds: number;
  broll_interval_seconds: number;
  broll_timing_mode: "fixed" | "semantic_pause" | "coverage_percent";
  broll_pacing_profile: "calm" | "balanced" | "dynamic";
  broll_pause_threshold_seconds: number;
  broll_coverage_percent: number;
  broll_semantic_relevance_priority: "precision" | "balanced" | "dynamic";
  broll_product_clip_policy: "contextual" | "required";
  broll_generator_model: "bytedance/v1-pro-text-to-video" | "bytedance/seedance-1.5-pro" | "grok-imagine/text-to-video" | "veo3" | "veo3_fast" | "veo3_lite";
  product_media_assets: ProductMediaAsset[];
  product_keyword: string;
  product_video_url: string;
  tts_provider: "minimax" | "elevenlabs";
  tts_voice_id: string;
  elevenlabs_voice_id: string;
  tts_silence_trim_min_duration_seconds: number;
  tts_silence_trim_threshold_db: number;
  tts_silence_trim_enabled: boolean;
  tts_sentence_trim_enabled: boolean;
  tts_sentence_trim_min_gap_seconds: number;
  tts_sentence_trim_keep_gap_seconds: number;
  tts_pronunciation_overrides: TtsPronunciationOverride[];
  subtitles_enabled: boolean;
  subtitle_mode: SubtitleMode;
  subtitle_style_preset: SubtitleStylePreset;
  subtitle_font_family: SubtitleFontFamily;
  subtitle_font_color: string;
  subtitle_font_weight: 400 | 700;
  subtitle_outline_color: string;
  subtitle_outline_width: number;
  subtitle_margin_v: number;
  subtitle_margin_percent: number;
  auto_generate_final_videos: boolean;
  daily_final_video_limit: number;
  daily_final_video_count: number;
  monthly_final_video_limit: number;
  monthly_final_video_count: number;
  open_final_video_jobs: number;
  learned_rules_scenario?: string;
  learned_rules_visual?: string;
  learned_rules_video?: string;
}

export interface MinimaxVoiceOption {
  voice_id: string;
  voice_name: string;
  category: "system" | "voice_cloning" | "voice_generation";
  description: string[];
  created_time?: string;
}

export interface ElevenLabsVoiceOption {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: {
    accent?: string;
    age?: string;
    description?: string;
    gender?: string;
    use_case?: string;
  };
}

// Compatibility aliases for modular Settings components.
export interface Voice {
  voice_id: string;
  voice_name?: string;
  name?: string;
  category?: string;
  description?: string | string[];
  preview_url?: string;
  labels?: {
    accent?: string;
    age?: string;
    description?: string;
    gender?: string;
    use_case?: string;
  };
}

export type ClientSettings = Settings & {
  auto_generate: boolean;
  monthly_limit: number;
};

export type Screen = "dashboard" | "references" | "scenarios" | "generator" | "settings" | "graph";

export interface WordTimestamp {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number | null;
}

export interface ProductMediaAsset {
  id: string;
  url: string;
  name: string;
  source_type?: "video" | "image";
  duration_seconds?: number | null;
  created_at?: string;
}

export interface ScenarioWordTimestamps {
  transcript?: string;
  words?: WordTimestamp[];
  updated_at?: string;
}

export interface ScenarioKeywordSegment {
  slot_start: number;
  slot_end: number;
  keyword: string;
  phrase?: string;
  word_start?: number;
  word_end?: number;
  visual_intent?: string;
  reason?: string;
  asset_type?: string;
  asset_url?: string;
  generate_video?: boolean;
}

export interface ScenarioKeywordSegmentsPayload {
  segments?: ScenarioKeywordSegment[];
  updated_at?: string;
}

export interface ScenarioVideoPromptItem {
  slot_start: number;
  slot_end: number;
  keyword?: string;
  phrase?: string;
  asset_type?: string;
  asset_url?: string | null;
  use_ready_asset?: boolean;
  prompt_json?: Record<string, unknown> | null;
  provider?: string | null;
  submission_status?: string | null;
  task_id?: string | null;
  task_state?: string | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  result_urls?: string[] | null;
  video_url?: string | null;
  progress?: number | null;
  cost_time?: number | null;
  create_time?: number | null;
  update_time?: number | null;
  complete_time?: number | null;
  error?: string | null;
}

export interface ScenarioVideoPromptsPayload {
  prompts?: ScenarioVideoPromptItem[];
  generator_model?: "bytedance/v1-pro-text-to-video" | "bytedance/seedance-1.5-pro" | "grok-imagine/text-to-video" | "veo3" | "veo3_fast" | "veo3_lite";
  updated_at?: string;
}

export interface HeygenAvatarLook {
  id?: number;
  look_id: string;
  look_name: string;
  preview_image_url?: string;
  motion_look_id?: string;
  motion_prompt?: string;
  motion_type?: string;
  motion_status?: string;
  motion_error?: string;
  motion_updated_at?: string;
  is_active?: boolean;
  usage_count?: number;
  sort_order?: number;
}

export type HeygenLookConfig = HeygenAvatarLook;

export interface HeygenAvatarConfig {
  id?: number;
  avatar_id: string;
  avatar_name: string;
  folder_name?: string;
  preview_image_url?: string;
  gender?: "male" | "female";
  tts_provider?: "minimax" | "elevenlabs";
  tts_voice_id?: string;
  elevenlabs_voice_id?: string;
  is_active?: boolean;
  usage_count?: number;
  sort_order?: number;
  looks: HeygenAvatarLook[];
}

export interface Scenario {
  id: number;
  job_id?: string;
  client_id?: number;
  mode?: string;
  generation_source?: "manual" | "auto";
  topic?: string;
  angle?: string;
  scenario_json?: {
    script?: string;
    hook?: string;
    visual_hooks?: string[];
    audio_triggers?: string[];
    pattern_type?: string;
  };
  tts_script?: string;
  tts_request_text?: string;
  tts_audio_path?: string;
  tts_audio_duration_seconds?: number | null;
  tts_word_timestamps?: ScenarioWordTimestamps;
  video_keyword_segments?: ScenarioKeywordSegmentsPayload;
  video_generation_prompts?: ScenarioVideoPromptsPayload;
  heygen_audio_asset_id?: string | null;
  heygen_video_id?: string | null;
  heygen_status?: string | null;
  heygen_error?: string | null;
  heygen_video_url?: string | null;
  heygen_thumbnail_url?: string | null;
  heygen_avatar_id?: string | null;
  heygen_avatar_name?: string | null;
  heygen_look_id?: string | null;
  heygen_look_name?: string | null;
  heygen_requested_at?: string | null;
  heygen_completed_at?: string | null;
  montage_video_path?: string | null;
  montage_status?: string | null;
  montage_error?: string | null;
  montage_updated_at?: string | null;
  background_audio_tag?: BackgroundAudioTag | null;
  montage_background_audio_name?: string | null;
  montage_background_audio_path?: string | null;
  montage_yandex_disk_path?: string | null;
  montage_yandex_public_url?: string | null;
  montage_yandex_status?: string | null;
  montage_yandex_error?: string | null;
  montage_yandex_uploaded_at?: string | null;
  created_at?: string;
  source_reference?: string;
  feedback_rating?: "like" | "dislike" | null;
  feedback_comment?: string | null;
  feedback_categories?: string | null;
}
