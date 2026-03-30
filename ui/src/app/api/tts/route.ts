import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import pool from '@/lib/db';

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
  return sentence.replace(/^([^\s,.;:!?()]+)/, `$1${interjection}`);
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
  return enrichMiniMaxTextWithInterjections(sanitizeBaseTtsText(text));
}

function prepareElevenLabsText(text: string) {
  return sanitizeBaseTtsText(text)
    .replace(/\[(surprise|whisper|joy|sad|angry|excited|soft|dramatic)\]/gi, '')
    .replace(MINIMAX_TAG_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(request: Request) {
  try {
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'");
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_voice_id TEXT');
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'");
    await pool.query('ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_request_text TEXT');
    const { text, scenarioId } = await request.json();
    const rawText = typeof text === 'string' ? text : '';

    if (!rawText.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    let selectedProvider = DEFAULT_TTS_PROVIDER;
    let selectedVoiceId = DEFAULT_MINIMAX_VOICE_ID;

    const resolvedScenarioId = Number.parseInt(String(scenarioId), 10);
    if (Number.isFinite(resolvedScenarioId)) {
      const { rows } = await pool.query<{ tts_provider: string | null; tts_voice_id: string | null; elevenlabs_voice_id: string | null }>(
        `SELECT c.tts_provider, c.tts_voice_id, c.elevenlabs_voice_id
         FROM generated_scenarios gs
         LEFT JOIN clients c ON c.id = gs.client_id
         WHERE gs.id = $1`,
        [resolvedScenarioId]
      );
      selectedProvider = rows[0]?.tts_provider || DEFAULT_TTS_PROVIDER;
      selectedVoiceId =
        selectedProvider === "elevenlabs"
          ? rows[0]?.elevenlabs_voice_id || DEFAULT_ELEVENLABS_VOICE_ID
          : rows[0]?.tts_voice_id || DEFAULT_MINIMAX_VOICE_ID;
    }

    const normalizedText = selectedProvider === "elevenlabs" ? prepareElevenLabsText(rawText) : prepareMiniMaxText(rawText);
    let audioBuffer: Buffer | null = null;

    if (selectedProvider === "elevenlabs") {
      if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY.includes('your_')) {
        return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured in .env.local' }, { status: 500 });
      }

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
            text: normalizedText,
            model_id: ELEVENLABS_TTS_MODEL,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`ElevenLabs HTTP Error ${response.status}: ${errorText}`);
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

      const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MINIMAX_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MINIMAX_TTS_MODEL,
          text: normalizedText,
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
            tone: buildPronunciationTone(normalizedText)
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`MiniMax HTTP Error ${response.status}: ${errorText}`);
        return NextResponse.json(
          { error: `MiniMax HTTP Error ${response.status}: ${errorText}` },
          { status: 500 }
        );
      }

      const result = await response.json();
      if (result.base_resp && result.base_resp.status_code !== 0) {
        console.error(`MiniMax Business Error: ${result.base_resp.status_msg}`);
        return NextResponse.json({ error: result.base_resp.status_msg }, { status: 500 });
      }

      if (!(result.data && result.data.audio)) {
        console.error('Unexpected response format from MiniMax:', result);
        return NextResponse.json({ error: 'Invalid response from MiniMax' }, { status: 500 });
      }

      audioBuffer = decodeAudioPayload(result.data.audio);
    }

    if (audioBuffer) {
      if (Number.isFinite(resolvedScenarioId)) {
        const targetDir = path.join('/tmp', 'platipo-miru-tts');
        await mkdir(targetDir, { recursive: true });
        const filePath = path.join(targetDir, `scenario_${resolvedScenarioId}.mp3`);
        await writeFile(filePath, audioBuffer);

        await pool.query(
          `UPDATE generated_scenarios
           SET tts_audio_path = $1,
               tts_request_text = $2
           WHERE id = $3`,
          [filePath, normalizedText, resolvedScenarioId]
        );
      }

      return new Response(audioBuffer, {
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
