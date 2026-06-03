import { NextResponse } from 'next/server';
import {
  appendDeepgramKeywords,
  applyDeepgramVocabularyToResult,
  buildDeepgramKeywordSource,
} from '@/lib/server/deepgram-keywords';

type DeepgramWord = {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
};

function normalizeWords(words: DeepgramWord[] = []) {
  return words
    .filter((word) => typeof word.word === 'string' && typeof word.start === 'number' && typeof word.end === 'number')
    .map((word) => ({
      word: word.word as string,
      punctuated_word: word.punctuated_word || word.word || '',
      start: Number((word.start as number).toFixed(2)),
      end: Number((word.end as number).toFixed(2)),
      confidence: typeof word.confidence === 'number' ? Number(word.confidence.toFixed(3)) : null,
    }));
}

export async function POST(request: Request) {
  try {
    const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

    if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY.includes('your_')) {
      return NextResponse.json({ error: 'Deepgram API key is not configured in .env.local' }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const keywords = formData.get('keywords');
    const vocabularyRules = formData.get('vocabularyRules');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Audio file is required' }, { status: 400 });
    }

    const audioBuffer = Buffer.from(await file.arrayBuffer());
    const deepgramUrl = new URL('https://api.deepgram.com/v1/listen');
    deepgramUrl.searchParams.set('model', 'nova-2');
    deepgramUrl.searchParams.set('language', 'ru');
    deepgramUrl.searchParams.set('smart_format', 'true');
    deepgramUrl.searchParams.set('punctuate', 'true');
    const keywordSource = buildDeepgramKeywordSource(
      typeof vocabularyRules === 'string' ? vocabularyRules : [],
      typeof keywords === 'string' ? keywords : ''
    );
    appendDeepgramKeywords(deepgramUrl, keywordSource);

    const response = await fetch(deepgramUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': file.type || 'audio/mpeg',
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Deepgram HTTP Error ${response.status}: ${errorText}` }, { status: 500 });
    }

    const result = await response.json();
    const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
    const normalized = applyDeepgramVocabularyToResult(
      {
        transcript: alternative?.transcript || '',
        words: normalizeWords(alternative?.words),
      },
      typeof vocabularyRules === 'string' ? vocabularyRules : [],
      keywordSource
    );

    return NextResponse.json({
      transcript: normalized.transcript,
      words: normalized.words,
    });
  } catch (error) {
    console.error('Deepgram timestamp API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
