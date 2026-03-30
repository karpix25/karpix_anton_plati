import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const query = `
      SELECT 
        audit_json->'atoms'->'narrative_skeleton' as skeleton,
        audit_json->'atoms'->'verbal_hook' as sample_hook,
        audit_json->'viral_dna_synthesis' as dna,
        reels_url,
        niche
      FROM processed_content 
      WHERE audit_json->'atoms'->'narrative_skeleton' IS NOT NULL
    `;
    
    const { rows } = await pool.query(query);
    
    // Group by unique skeleton (JSON stringified for comparison)
    const frameMap = new Map<string, any>();
    
    // Semantic Harmonizer: Maps specific terms to abstract marketing blocks
    const harmonizer = (step: string) => {
      const s = step.toLowerCase();
      if (s.includes('hook') || s.includes('крючок') || s.includes('intro')) return 'Крючок (Hook)';
      if (s.includes('problem') || s.includes('проблема') || s.includes('bolt')) return 'Проблема (Problem)';
      if (s.includes('solution') || s.includes('решение') || s.includes('product')) return 'Решение (Solution)';
      if (s.includes('cta') || s.includes('call to action') || s.includes('призыв')) return 'Призыв (CTA)';
      if (s.includes('proof') || s.includes('доказательство') || s.includes('example')) return 'Доказательства (Proof)';
      if (s.includes('contrast') || s.includes('before') || s.includes('contrast')) return 'Контраст (Contrast)';
      if (s.includes('myth') || s.includes('ошибка') || s.includes('mistake')) return 'Разбор ошибок';
      return step;
    };

    rows.forEach(row => {
      let skeleton = row.skeleton;
      if (!Array.isArray(skeleton)) return;
      
      // Harmonize skeleton steps to be abstract
      skeleton = skeleton.map((s: string) => harmonizer(s));
      
      const key = JSON.stringify(skeleton);
      if (frameMap.has(key)) {
        frameMap.get(key).count += 1;
        frameMap.get(key).references.push({ url: row.reels_url, niche: row.niche });
      } else {
        frameMap.set(key, {
          skeleton,
          sample_hook: row.sample_hook,
          dna: row.dna,
          count: 1,
          references: [{ url: row.reels_url, niche: row.niche }]
        });
      }
    });

    const frames = Array.from(frameMap.values()).sort((a, b) => b.count - a.count);
    
    return NextResponse.json(frames);
  } catch (error) {
    console.error('Database error in /api/frames:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
