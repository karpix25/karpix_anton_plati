const DEFAULT_DEEPGRAM_KEYWORD_BOOST = 5;
const MAX_DEEPGRAM_KEYWORDS = 100;

export type DeepgramVocabularyRule = {
  display: string;
  variants: string;
};

export type DeepgramWordLike = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number | null;
};

function splitTerms(value: unknown) {
  if (typeof value !== "string") return [];
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function normalizeComparable(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function trailingPunctuation(value: string) {
  return value.match(/[^\p{L}\p{N}]+$/u)?.[0] || "";
}

export function normalizeDeepgramKeywordsInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDeepgramVocabularyRulesInput(value: unknown, legacyKeywords?: unknown) {
  const source = typeof value === "string" ? safeJsonParse(value) : value;
  const normalized = Array.isArray(source)
    ? source
        .map((item): DeepgramVocabularyRule | null => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const candidate = item as Record<string, unknown>;
          const display = normalizeDeepgramKeywordsInput(candidate.display);
          const variants = normalizeDeepgramKeywordsInput(candidate.variants);
          if (!display) return null;
          return { display, variants };
        })
        .filter((item): item is DeepgramVocabularyRule => Boolean(item))
    : [];

  if (normalized.length) return normalized;

  const legacyTerms = splitTerms(legacyKeywords);
  if (legacyTerms.length <= 1) return [];
  return [{ display: legacyTerms[0], variants: legacyTerms.slice(1).join(", ") }];
}

export function buildDeepgramKeywordSource(rules: unknown, legacyKeywords?: unknown) {
  const vocabularyRules = normalizeDeepgramVocabularyRulesInput(rules, legacyKeywords);
  const terms = vocabularyRules.flatMap((rule) => [rule.display, ...splitTerms(rule.variants)]);
  if (terms.length) return terms.join(", ");
  return normalizeDeepgramKeywordsInput(legacyKeywords);
}

export function parseDeepgramKeywordParams(value: unknown) {
  const terms = splitTerms(value);

  return terms.slice(0, MAX_DEEPGRAM_KEYWORDS).map((item) => {
    const boostMatch = item.match(/^(.+):(-?\d+(?:\.\d+)?)$/);
    if (!boostMatch) {
      return `${item}:${DEFAULT_DEEPGRAM_KEYWORD_BOOST}`;
    }

    const keyword = boostMatch[1].trim();
    const boost = Math.min(10, Math.max(1, Number(boostMatch[2])));
    return `${keyword}:${Number.isFinite(boost) ? boost : DEFAULT_DEEPGRAM_KEYWORD_BOOST}`;
  });
}

export function appendDeepgramKeywords(url: URL, value: unknown) {
  for (const keyword of parseDeepgramKeywordParams(value)) {
    url.searchParams.append("keywords", keyword);
  }
}

export function applyDeepgramVocabularyToResult<TWord extends DeepgramWordLike>(
  result: { transcript: string; words: TWord[] },
  rules: unknown,
  legacyKeywords?: unknown
) {
  const vocabularyRules = normalizeDeepgramVocabularyRulesInput(rules, legacyKeywords);
  if (!vocabularyRules.length) return result;

  const replacements = vocabularyRules.flatMap((rule) =>
    [rule.display, ...splitTerms(rule.variants)]
      .map((term) => ({ display: rule.display, term, tokens: term.split(/\s+/).filter(Boolean) }))
      .filter((item) => item.tokens.length > 0)
  );

  return {
    transcript: applyTranscriptReplacements(result.transcript, replacements),
    words: applyWordReplacements(result.words, replacements),
  };
}

function applyTranscriptReplacements(
  transcript: string,
  replacements: Array<{ display: string; term: string }>
) {
  return replacements.reduce((text, replacement) => {
    const escaped = replacement.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(escaped, "giu"), replacement.display);
  }, transcript || "");
}

function applyWordReplacements<TWord extends DeepgramWordLike>(
  words: TWord[],
  replacements: Array<{ display: string; tokens: string[] }>
) {
  const result: TWord[] = [];
  let index = 0;

  while (index < words.length) {
    const match = findReplacement(words, index, replacements);
    if (!match) {
      result.push(words[index]);
      index += 1;
      continue;
    }

    const slice = words.slice(index, index + match.tokens.length);
    const first = slice[0];
    const last = slice[slice.length - 1];
    const punctuation = trailingPunctuation(last.punctuated_word || last.word || "");
    result.push({
      ...first,
      word: match.display,
      punctuated_word: `${match.display}${punctuation}`,
      end: last.end,
      confidence: minConfidence(slice),
    });
    index += match.tokens.length;
  }

  return result;
}

function findReplacement<TWord extends DeepgramWordLike>(
  words: TWord[],
  index: number,
  replacements: Array<{ display: string; tokens: string[] }>
) {
  return replacements
    .filter((replacement) => replacement.tokens.length <= words.length - index)
    .sort((a, b) => b.tokens.length - a.tokens.length)
    .find((replacement) =>
      replacement.tokens.every((token, offset) => {
        const word = words[index + offset];
        return normalizeComparable(word.punctuated_word || word.word) === normalizeComparable(token);
      })
    );
}

function minConfidence(words: DeepgramWordLike[]) {
  const values = words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  return values.length ? Math.min(...values) : null;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
