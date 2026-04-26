import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import pool from '@/lib/db';
import { notifyServicePaymentIssue } from '@/lib/server/notifier';

const DEFAULT_TTS_PROVIDER = "minimax";
const DEFAULT_MINIMAX_VOICE_ID = "Russian_Engaging_Podcaster_v1";
const MINIMAX_TTS_MODEL = "speech-2.8-hd";
const DEFAULT_ELEVENLABS_VOICE_ID = "0ArNnoIAWKlT4WweaVMY";
const ELEVENLABS_TTS_MODEL = "eleven_v3";
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const SUPPORTED_INTERJECTION_PATTERN =
  /\((?:laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|sneezes)\)/i;
const MINIMAX_TAG_PATTERN =
  /\((?:laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|sneezes)\)/gi;

type PronunciationRule = {
  source: string;
  target: string;
  aliases?: string[];
};

type ElevenLabsReplacementRule = {
  search: string;
  replace: string;
  case_sensitive?: boolean;
  word_boundaries?: boolean;
};

type DeepgramWord = {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
};

const PRONUNCIATION_RULES: PronunciationRule[] = [
  { source: 'Airbnb', target: 'Эйрбиэнби', aliases: ['airbnb'] },
  { source: 'Booking', target: 'Букинг', aliases: ['booking.com', 'Booking.com', 'booking'] },
  { source: 'Netflix', target: 'Нетфликс', aliases: ['netflix'] },
  { source: 'YouTube', target: 'Ютуб', aliases: ['Youtube', 'youtube'] },
  { source: 'TikTok', target: 'Тикток', aliases: ['Tiktok', 'tiktok'] },
  { source: 'Instagram', target: 'Инстаграм', aliases: ['instagram'] },
  { source: 'WhatsApp', target: 'Вотсап', aliases: ['Whatsapp', 'whatsapp'] },
  { source: 'Telegram', target: 'Телеграм', aliases: ['telegram'] },
  { source: 'PayPal', target: 'Пэйпэл', aliases: ['Paypal', 'paypal'] },
  { source: 'Wise', target: 'Вайз', aliases: ['wise'] },
  { source: '7-Eleven', target: 'севен илевен', aliases: ['7-11', '7 eleven', 'seven eleven', 'Seven Eleven', 'семь-одиннадцать', 'семь одиннадцать'] },
  { source: 'Payoneer', target: 'Пайонир', aliases: ['payoneer'] },
  { source: 'Revolut', target: 'Револют', aliases: ['revolut'] },
  { source: 'Binance', target: 'Байнэнс', aliases: ['binance'] },
  { source: 'Mastercard', target: 'Мастеркард', aliases: ['mastercard', 'MasterCard'] },
  { source: 'Visa', target: 'Виза', aliases: ['visa'] },
  { source: 'digital nomad', target: 'диджитал ноумад', aliases: ['Digital Nomad', 'digital-nomad'] },
  { source: 'relocation', target: 'релокейшн', aliases: ['Relocation'] },
  { source: 'coworking', target: 'коворкинг', aliases: ['Coworking'] },
  { source: 'workation', target: 'воркейшн', aliases: ['Workation'] },
  { source: 'startup visa', target: 'стартап виза', aliases: ['Startup Visa', 'startup-visa'] },
  { source: 'residence permit', target: 'резиденс пермит', aliases: ['Residence Permit'] },
  { source: 'green card', target: 'грин кард', aliases: ['Green Card'] },
  { source: 'job offer', target: 'джоб оффер', aliases: ['Job Offer'] },
  { source: 'offer letter', target: 'оффер леттер', aliases: ['Offer Letter'] },
  { source: 'check-in', target: 'чек-ин', aliases: ['check in', 'Check-in', 'Check In'] },
  { source: 'check-out', target: 'чек-аут', aliases: ['check out', 'Check-out', 'Check Out'] },
  { source: 'low-cost', target: 'лоукост', aliases: ['low cost', 'Low-cost'] },
  { source: 'upgrade', target: 'апгрейд', aliases: ['Upgrade'] },
  { source: 'cashback', target: 'кэшбэк', aliases: ['Cashback', 'cash back'] },
  { source: 'tax free', target: 'такс фри', aliases: ['Tax Free', 'tax-free'] },
  { source: 'duty free', target: 'дьюти фри', aliases: ['Duty Free', 'duty-free'] },
  { source: 'visa run', target: 'виза ран', aliases: ['Visa Run', 'visa-run'] },
  { source: 'border run', target: 'бордер ран', aliases: ['Border Run', 'border-run'] },
  { source: 'overstay', target: 'овэрстэй', aliases: ['Overstay'] },
  { source: 'jet lag', target: 'джетлаг', aliases: ['Jet Lag', 'jetlag'] },
  { source: 'all inclusive', target: 'ол инклюзив', aliases: ['All Inclusive', 'all-inclusive'] },
];

const WORD_BOUNDARY_CLASS = "A-Za-zА-Яа-яЁё0-9_";

const RU_UNITS_MASC = ['', 'odin', 'dva', 'tri', 'chetyre', 'pyat', 'shest', 'sem', 'vosem', 'devyat'];
const RU_UNITS_FEM = ['', 'odna', 'dve', 'tri', 'chetyre', 'pyat', 'shest', 'sem', 'vosem', 'devyat'];
const RU_TEENS = ['desyat', 'odinnadtsat', 'dvenadtsat', 'trinadtsat', 'chetyrnadtsat', 'pyatnadtsat', 'shestnadtsat', 'semnadtsat', 'vosemnadtsat', 'devyatnadtsat'];
const RU_TENS = ['', '', 'dvadtsat', 'tridtsat', 'sorok', 'pyatdesyat', 'shestdesyat', 'semdesyat', 'vosemdesyat', 'devyanosto'];
const RU_HUNDREDS = ['', 'sto', 'dvesti', 'trista', 'chetyresta', 'pyatsot', 'shestsot', 'semsot', 'vosemsot', 'devyatsot'];

function translitToCyrillic(word: string) {
  const map: Record<string, string> = {
    odin: 'один',
    dva: 'два',
    tri: 'три',
    chetyre: 'четыре',
    pyat: 'пять',
    shest: 'шесть',
    sem: 'семь',
    vosem: 'восемь',
    devyat: 'девять',
    odna: 'одна',
    dve: 'две',
    desyat: 'десять',
    odinnadtsat: 'одиннадцать',
    dvenadtsat: 'двенадцать',
    trinadtsat: 'тринадцать',
    chetyrnadtsat: 'четырнадцать',
    pyatnadtsat: 'пятнадцать',
    shestnadtsat: 'шестнадцать',
    semnadtsat: 'семнадцать',
    vosemnadtsat: 'восемнадцать',
    devyatnadtsat: 'девятнадцать',
    dvadtsat: 'двадцать',
    tridtsat: 'тридцать',
    sorok: 'сорок',
    pyatdesyat: 'пятьдесят',
    shestdesyat: 'шестьдесят',
    semdesyat: 'семьдесят',
    vosemdesyat: 'восемьдесят',
    devyanosto: 'девяносто',
    sto: 'сто',
    dvesti: 'двести',
    trista: 'триста',
    chetyresta: 'четыреста',
    pyatsot: 'пятьсот',
    shestsot: 'шестьсот',
    semsot: 'семьсот',
    vosemsot: 'восемьсот',
    devyatsot: 'девятьсот',
    tysyacha: 'тысяча',
    tysyachi: 'тысячи',
    tysyach: 'тысяч',
    million: 'миллион',
    milliona: 'миллиона',
    millionov: 'миллионов',
    milliard: 'миллиард',
    milliarda: 'миллиарда',
    milliardov: 'миллиардов',
  };

  return map[word] ?? word;
}

function choosePlural(n: number, one: string, few: string, many: string) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;

  if (abs >= 11 && abs <= 19) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function convertTriplet(num: number, feminine = false) {
  if (num === 0) return [];

  const words: string[] = [];
  const hundreds = Math.floor(num / 100);
  const tensUnits = num % 100;
  const tens = Math.floor(tensUnits / 10);
  const units = tensUnits % 10;
  const unitWords = feminine ? RU_UNITS_FEM : RU_UNITS_MASC;

  if (hundreds) words.push(RU_HUNDREDS[hundreds]);

  if (tensUnits >= 10 && tensUnits <= 19) {
    words.push(RU_TEENS[tensUnits - 10]);
    return words;
  }

  if (tens) words.push(RU_TENS[tens]);
  if (units) words.push(unitWords[units]);

  return words;
}

function numberToRussianWords(raw: string) {
  const normalized = raw.replace(/^0+(\d)/, '$1') || '0';
  const num = Number.parseInt(normalized, 10);

  if (!Number.isFinite(num)) return raw;
  if (num === 0) return 'ноль';

  const parts: string[] = [];
  const billions = Math.floor(num / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;

  if (billions) {
    parts.push(...convertTriplet(billions), choosePlural(billions, 'milliard', 'milliarda', 'milliardov'));
  }

  if (millions) {
    parts.push(...convertTriplet(millions), choosePlural(millions, 'million', 'milliona', 'millionov'));
  }

  if (thousands) {
    parts.push(...convertTriplet(thousands, true), choosePlural(thousands, 'tysyacha', 'tysyachi', 'tysyach'));
  }

  if (rest) {
    parts.push(...convertTriplet(rest));
  }

  return parts.map(translitToCyrillic).join(' ');
}

function decimalToRussianWords(raw: string) {
  const [wholeRaw, fractionRaw] = raw.split(/[.,]/);
  const whole = numberToRussianWords(wholeRaw);
  const fraction = fractionRaw
    .split('')
    .map((digit) => numberToRussianWords(digit))
    .join(' ');

  return `${whole} целых ${fraction}`;
}

function spellOutNumbersRu(text: string) {
  return text
    .replace(/\b(\d+[.,]\d+)\s*%/g, (_, num: string) => `${decimalToRussianWords(num)} ${choosePlural(Number.parseFloat(num), 'процент', 'процента', 'процентов')}`)
    .replace(/\b(\d+)\s*%/g, (_, num: string) => `${numberToRussianWords(num)} ${choosePlural(Number.parseInt(num, 10), 'процент', 'процента', 'процентов')}`)
    .replace(/\b(\d+[.,]\d+)\b/g, (_, num: string) => decimalToRussianWords(num))
    .replace(/\b(\d+)\b/g, (_, num: string) => numberToRussianWords(num));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeElevenLabsOverrides(value: unknown): ElevenLabsReplacementRule[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeElevenLabsOverrides(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const search = String((item as Record<string, unknown>).search || "").trim();
      const replace = String((item as Record<string, unknown>).replace || "").trim();
      if (!search || !replace) return null;
      return {
        search,
        replace,
        case_sensitive: Boolean((item as Record<string, unknown>).case_sensitive),
        word_boundaries: Boolean((item as Record<string, unknown>).word_boundaries),
      } as ElevenLabsReplacementRule;
    })
    .filter((item): item is ElevenLabsReplacementRule => Boolean(item));
}

function buildPronunciationTone(text: string) {
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const rule of PRONUNCIATION_RULES) {
    const variants = [rule.source, ...(rule.aliases ?? [])];

    for (const variant of variants) {
      const regex = new RegExp(`(^|[^A-Za-zА-Яа-яЁё])(${escapeRegExp(variant)})(?=$|[^A-Za-zА-Яа-яЁё])`, 'i');
      const match = text.match(regex);

      if (!match) continue;

      const source = match[2];
      const entry = `${source}/${rule.target}`;

      if (!seen.has(entry)) {
        entries.push(entry);
        seen.add(entry);
      }
    }
  }

  return entries;
}

function decodeAudioPayload(audio: string) {
  const normalized = audio.trim();

  if (!normalized) {
    throw new Error('MiniMax returned empty audio payload');
  }

  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    return Buffer.from(normalized, 'hex');
  }

  return Buffer.from(normalized, 'base64');
}

function attachInterjectionAfterFirst(text: string, pattern: RegExp, interjection: string) {
  return text.replace(pattern, (_match, phrase: string, punctuation = '') => `${phrase}${interjection}${punctuation}`);
}

function attachInterjectionToSentenceLead(sentence: string, interjection: string) {
  // Only attach if the first word is substantial (>4 chars)
  const words = sentence.split(/\s+/);
  if (words.length > 0 && words[0].length > 4) {
    return sentence.replace(/^([^\s,.;:!?()]{5,})/, `$1${interjection}`);
  }
  
  // If first word is short, try to find a better spot after the first or second word if followed by a space
  return sentence.replace(/^([^\s,.;:!?()]+\s+[^\s,.;:!?()]{4,})/, `$1${interjection}`);
}

function enrichMiniMaxTextWithInterjections(text: string) {
  let enriched = text;

  const editorCueMap: Record<string, string> = {
    surprise: '(gasps)',
    whisper: '(breath)',
    joy: '(chuckle)',
    sad: '(sighs)',
    angry: '(snorts)',
    excited: '(inhale)',
    soft: '(breath)',
    dramatic: '(inhale)',
  };

  enriched = enriched.replace(/\s*\[(surprise|whisper|joy|sad|angry|excited|soft|dramatic)\]/gi, (match, cue: string) => {
    const replacement = editorCueMap[cue.toLowerCase()];
    return replacement || match;
  });

  if (SUPPORTED_INTERJECTION_PATTERN.test(enriched)) {
    return enriched
      .replace(/\s+\(/g, '(')
      .replace(/\)\s+([,.;:!?])/g, ')$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const directRules: Array<{ pattern: RegExp; interjection: string }> = [
    { pattern: /(\b(?:ха-?ха|хаха|усмехнувшись|усмехается|смешно)\b)([,.;:!?]?)/i, interjection: '(chuckle)' },
    { pattern: /(\b(?:эх|увы|к сожалению)\b)([,.;:!?]?)/i, interjection: '(sighs)' },
    { pattern: /(\b(?:ничего себе|вот это да|неужели|серьёзно|серьезно)\b)([,.;:!?]?)/i, interjection: '(gasps)' },
  ];

  for (const rule of directRules) {
    if (rule.pattern.test(enriched)) {
      enriched = attachInterjectionAfterFirst(enriched, rule.pattern, rule.interjection);
      break;
    }
  }

  const sentences = enriched.match(/[^.!?]+[.!?]?/g) || [enriched];
  let injectedCount = (enriched.match(/\(/g) || []).length;

  const rebuiltSentences = sentences.map((rawSentence) => {
    const sentence = rawSentence.trim();
    if (!sentence || SUPPORTED_INTERJECTION_PATTERN.test(sentence) || injectedCount >= 3) {
      return rawSentence;
    }

    const lower = sentence.toLowerCase();
    let interjection = "";

    if (/\b(?:давайте|смотрите|представьте|теперь)\b/i.test(sentence)) {
      interjection = "(inhale)";
    } else if (/\b(?:кстати|ну|знаете)\b/i.test(sentence)) {
      interjection = "(emm)";
    } else if (/\b(?:ошибка|разочар|депрессив|проблем|санкц|налог|риск|тяжело|сложно)\b/i.test(sentence)) {
      interjection = "(sighs)";
    } else if (sentence.length > 90 || /\b(?:автоматически|финансов|независим|благополуч)\b/i.test(lower)) {
      interjection = "(breath)";
    }

    if (!interjection) {
      return rawSentence;
    }

    // Limit to max 2 auto-injected interjections for the whole text to avoid "heavy breathing"
    if (injectedCount >= 2) {
        return rawSentence;
    }

    injectedCount += 1;
    const punctMatch = rawSentence.match(/[.!?]\s*$/);
    const punctuation = punctMatch ? punctMatch[0].trim() : "";
    const body = punctuation ? sentence.slice(0, -punctuation.length) : sentence;
    const injected = attachInterjectionToSentenceLead(body, interjection);

    return `${injected}${punctuation}${rawSentence.endsWith(" ") ? " " : ""}`;
  });

  enriched = rebuiltSentences.join(" ");

  return enriched
    .replace(/\s+\(/g, '(')
    .replace(/\)\s+([,.;:!?])/g, ')$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeBaseTtsText(text: string) {
  return spellOutNumbersRu(
    text
    .replace(/<#[0-9]+(?:\.[0-9]{1,2})?#>/g, ' ')
    .replace(/\+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
  );
}

function prepareMiniMaxText(text: string) {
  // Disabled auto-interjections by user request
  return sanitizeBaseTtsText(text);
}

function prepareElevenLabsText(text: string) {
  return sanitizeBaseTtsText(text)
    .replace(/\[(surprise|whisper|joy|sad|angry|excited|soft|dramatic)\]/gi, '')
    .replace(MINIMAX_TAG_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyElevenLabsReplacements(text: string, rules: ElevenLabsReplacementRule[]) {
  let resolved = text;

  for (const rule of rules) {
    const escapedSearch = escapeRegExp(rule.search);
    const flags = `g${rule.case_sensitive ? "" : "i"}`;

    if (rule.word_boundaries) {
      const pattern = new RegExp(`(^|[^${WORD_BOUNDARY_CLASS}])(${escapedSearch})(?=$|[^${WORD_BOUNDARY_CLASS}])`, flags);
      resolved = resolved.replace(pattern, (_match, prefix: string) => `${prefix}${rule.replace}`);
      continue;
    }

    const pattern = new RegExp(escapedSearch, flags);
    resolved = resolved.replace(pattern, rule.replace);
  }

  return resolved;
}

function runCommandCapture(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `${command} failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function probeDurationSeconds(filePath: string) {
  const raw = await runCommandCapture('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);

  const duration = Number(raw);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

async function normalizeAudioBuffer(buffer: Buffer): Promise<Buffer> {
  const tempDir = path.join('/tmp', 'platipo-miru-tts-norm');
  await mkdir(tempDir, { recursive: true });
  const inputPath = path.join(tempDir, `input_${Date.now()}.mp3`);
  const outputPath = path.join(tempDir, `output_${Date.now()}.mp3`);

  try {
    await writeFile(inputPath, buffer);
    // Simple pass-through via ffmpeg to fix headers and duration metadata
    await runCommandCapture('ffmpeg', ['-i', inputPath, '-y', outputPath]);
    const normalizedBuffer = await require('fs/promises').readFile(outputPath);
    return normalizedBuffer;
  } catch (err) {
    console.error('[TTS] Audio normalization failed, using raw buffer:', err);
    return buffer;
  } finally {
    // Clean up temp files
    try {
      const { unlink } = require('fs/promises');
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    } catch {}
  }
}

function normalizeDeepgramWords(words: DeepgramWord[] = []) {
  return words
    .filter((word) => typeof word.word === "string" && typeof word.start === "number" && typeof word.end === "number")
    .map((word) => ({
      word: word.word as string,
      punctuated_word: word.punctuated_word || word.word || "",
      start: Number((word.start as number).toFixed(2)),
      end: Number((word.end as number).toFixed(2)),
      confidence: typeof word.confidence === "number" ? Number(word.confidence.toFixed(3)) : null,
    }))
    .filter((word) => word.end > word.start);
}

async function transcribeAudioWithDeepgram(audioBuffer: Buffer, contentType: string) {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  if (!deepgramApiKey || deepgramApiKey.includes("your_")) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const deepgramUrl = new URL("https://api.deepgram.com/v1/listen");
  deepgramUrl.searchParams.set("model", "nova-2");
  deepgramUrl.searchParams.set("language", "ru");
  deepgramUrl.searchParams.set("smart_format", "true");
  deepgramUrl.searchParams.set("punctuate", "true");

  const response = await fetch(deepgramUrl, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": contentType || "audio/mpeg",
    },
    body: new Uint8Array(audioBuffer),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram HTTP Error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
  return {
    transcript: alternative?.transcript || "",
    words: normalizeDeepgramWords(alternative?.words || []),
  };
}

export async function POST(request: Request) {
  try {
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'");
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_voice_id TEXT');
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'");
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_pronunciation_overrides JSONB DEFAULT '[]'::jsonb");
    await pool.query("ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'");
    await pool.query('ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_voice_id TEXT');
    await pool.query("ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'");
    await pool.query('ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_request_text TEXT');
    await pool.query('ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_audio_duration_seconds NUMERIC(10,3)');
    await pool.query('ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_word_timestamps JSONB');
    const { text, scenarioId } = await request.json();
    const rawText = typeof text === 'string' ? text : '';
    console.log(`[TTS] POST start: scenarioId=${String(scenarioId ?? "NULL")} textLength=${rawText.length}`);

    if (!rawText.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    let selectedProvider = DEFAULT_TTS_PROVIDER;
    let selectedVoiceId = DEFAULT_MINIMAX_VOICE_ID;
    let selectedPronunciationOverrides: ElevenLabsReplacementRule[] = [];

    const resolvedScenarioId = Number.parseInt(String(scenarioId), 10);
    let resolvedClientId: number | null = null;

    if (Number.isFinite(resolvedScenarioId)) {
      // Diagnostic: fetch scenario's heygen_avatar_id first
      const { rows: scenarioRows } = await pool.query<{ heygen_avatar_id: string | null; client_id: number | null }>(
        `SELECT heygen_avatar_id, client_id FROM generated_scenarios WHERE id = $1`,
        [resolvedScenarioId]
      );
      resolvedClientId = scenarioRows[0]?.client_id ?? null;
      console.log(`[TTS] scenario ${resolvedScenarioId}: heygen_avatar_id=${scenarioRows[0]?.heygen_avatar_id ?? 'NULL'}, client_id=${resolvedClientId ?? 'NULL'}`);

      const { rows } = await pool.query<{
        tts_provider: string | null;
        tts_voice_id: string | null;
        elevenlabs_voice_id: string | null;
        tts_pronunciation_overrides: unknown;
      }>(
        `SELECT
           COALESCE(a.tts_provider, c.tts_provider) AS tts_provider,
           COALESCE(a.tts_voice_id, c.tts_voice_id) AS tts_voice_id,
           COALESCE(a.elevenlabs_voice_id, c.elevenlabs_voice_id) AS elevenlabs_voice_id,
           c.tts_pronunciation_overrides AS tts_pronunciation_overrides,
           a.tts_provider AS avatar_tts_provider,
           a.avatar_id AS matched_avatar_id
         FROM generated_scenarios gs
         LEFT JOIN clients c ON c.id = gs.client_id
         LEFT JOIN client_heygen_avatars a
           ON a.client_id = gs.client_id
          AND a.avatar_id = gs.heygen_avatar_id
         WHERE gs.id = $1`,
        [resolvedScenarioId]
      );
      console.log(`[TTS] resolved row: tts_provider=${(rows[0] as Record<string, unknown>)?.tts_provider}, avatar_tts_provider=${(rows[0] as Record<string, unknown>)?.avatar_tts_provider}, matched_avatar_id=${(rows[0] as Record<string, unknown>)?.matched_avatar_id}`);
      selectedProvider = rows[0]?.tts_provider || DEFAULT_TTS_PROVIDER;
      selectedVoiceId =
        selectedProvider === "elevenlabs"
          ? rows[0]?.elevenlabs_voice_id || DEFAULT_ELEVENLABS_VOICE_ID
          : rows[0]?.tts_voice_id || DEFAULT_MINIMAX_VOICE_ID;
      selectedPronunciationOverrides = normalizeElevenLabsOverrides(rows[0]?.tts_pronunciation_overrides);
      console.log(`[TTS] final provider=${selectedProvider}, voiceId=${selectedVoiceId}`);
    }

    const normalizedText = selectedProvider === "elevenlabs" ? prepareElevenLabsText(rawText) : prepareMiniMaxText(rawText);
    let requestText = normalizedText;
    let audioBuffer: Buffer | null = null;

    if (selectedProvider === "elevenlabs") {
      if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY.includes('your_')) {
        return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured in .env.local' }, { status: 500 });
      }

      requestText = applyElevenLabsReplacements(normalizedText, selectedPronunciationOverrides);

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId || DEFAULT_ELEVENLABS_VOICE_ID}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
          },
          body: JSON.stringify({
            text: requestText,
            model_id: ELEVENLABS_TTS_MODEL,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`ElevenLabs HTTP Error ${response.status}: ${errorText}`);
        await notifyServicePaymentIssue(resolvedClientId, 'ElevenLabs', errorText);
        return NextResponse.json(
          { error: `ElevenLabs HTTP Error ${response.status}: ${errorText}` },
          { status: 500 }
        );
      }

      audioBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      if (!MINIMAX_API_KEY || MINIMAX_API_KEY.includes('your_')) {
        return NextResponse.json({ error: 'MiniMax API keys are not configured in .env.local' }, { status: 500 });
      }

      requestText = applyElevenLabsReplacements(normalizedText, selectedPronunciationOverrides);

      const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MINIMAX_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MINIMAX_TTS_MODEL,
          text: requestText,
          stream: false,
          language_boost: "Russian",
          voice_setting: {
            voice_id: selectedVoiceId,
            speed: 1.1,
            vol: 1.0,
            pitch: 0
          },
          audio_setting: {
            audio_sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1
          },
          pronunciation_dict: {
            tone: buildPronunciationTone(requestText)
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`MiniMax HTTP Error ${response.status}: ${errorText}`);
        await notifyServicePaymentIssue(resolvedClientId, 'MiniMax', errorText);
        return NextResponse.json(
          { error: `MiniMax HTTP Error ${response.status}: ${errorText}` },
          { status: 500 }
        );
      }

      const result = await response.json();
      if (result.base_resp && result.base_resp.status_code !== 0) {
        console.error(`MiniMax Business Error: ${result.base_resp.status_msg}`);
        await notifyServicePaymentIssue(resolvedClientId, 'MiniMax', result.base_resp.status_msg);
        return NextResponse.json({ error: result.base_resp.status_msg }, { status: 500 });
      }

      if (!(result.data && result.data.audio)) {
        console.error('Unexpected response format from MiniMax:', result);
        return NextResponse.json({ error: 'Invalid response from MiniMax' }, { status: 500 });
      }

      audioBuffer = decodeAudioPayload(result.data.audio);
    }

    if (audioBuffer) {
      // FIX: Normalize audio to ensure Deepgram and Player have the same timeline
      const finalAudioBuffer = await normalizeAudioBuffer(audioBuffer);

      if (Number.isFinite(resolvedScenarioId)) {
        const targetDir = path.join('/tmp', 'platipo-miru-tts');
        await mkdir(targetDir, { recursive: true });
        const filePath = path.join(targetDir, `scenario_${resolvedScenarioId}.mp3`);
        await writeFile(filePath, finalAudioBuffer);
        const audioDurationSeconds = await probeDurationSeconds(filePath);
        let timestampPayloadJson: string | null = null;

        try {
          const deepgramData = await transcribeAudioWithDeepgram(finalAudioBuffer, "audio/mpeg");
          timestampPayloadJson = JSON.stringify({
            transcript: deepgramData.transcript || "",
            words: deepgramData.words || [],
            updated_at: new Date().toISOString(),
            is_fallback: false,
          });
        } catch (deepgramError) {
          console.warn(
            `Deepgram timestamp refresh failed for scenario ${resolvedScenarioId}; subtitles will require re-analysis before assembly:`,
            deepgramError
          );
        }

        await pool.query(
          `UPDATE generated_scenarios
           SET tts_audio_path = $1,
               tts_request_text = $2,
               tts_audio_duration_seconds = $3,
               tts_word_timestamps = $4::jsonb
           WHERE id = $5`,
          [filePath, requestText, audioDurationSeconds || null, timestampPayloadJson, resolvedScenarioId]
        );
      }
      console.log(
        `[TTS] POST success: scenarioId=${Number.isFinite(resolvedScenarioId) ? resolvedScenarioId : "NULL"} provider=${selectedProvider} voiceId=${selectedVoiceId} requestTextLength=${requestText.length}`
      );

      return new Response(new Uint8Array(finalAudioBuffer), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': `attachment; filename="scenario_${scenarioId}_audio.mp3"`,
        },
      });
    }
    return NextResponse.json({ error: 'TTS provider did not return audio' }, { status: 500 });

  } catch (error) {
    console.error('API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
