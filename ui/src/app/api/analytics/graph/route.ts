import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  try {
    // 1. Fetch Topics with their primary pattern
    const topicResult = await pool.query(
      `SELECT t.id, t.topic_short as label, t.topic_family, t.canonical_topic_family, t.country, t.hunt_stage,
              (SELECT s.canonical_pattern_key 
               FROM topic_structure_pairs tsp
               JOIN structure_cards s ON s.id = tsp.structure_card_id
               WHERE tsp.topic_card_id = t.id
               ORDER BY tsp.pair_count DESC LIMIT 1) as pattern
       FROM topic_cards t WHERE t.client_id = $1`,
      [clientId]
    );

    // 2. Fetch Structures
    const structResult = await pool.query(
      `SELECT id, pattern_type as label, canonical_pattern_key, narrator_role 
       FROM structure_cards WHERE client_id = $1`,
      [clientId]
    );

    // 3. Fetch Edges
    const pairResult = await pool.query(
      `SELECT topic_card_id, structure_card_id, pair_count 
       FROM topic_structure_pairs WHERE client_id = $1`,
      [clientId]
    );

    const nodes = [
      ...topicResult.rows.map((row: any) => ({
        id: `topic_${row.id}`,
        type: 'topic',
        data: { 
          label: row.label,
          family: row.canonical_topic_family,
          country: row.country || 'Мир',
          huntStage: row.hunt_stage || 'Не определена',
          pattern: row.pattern || 'other'
        },
      })),
      ...structResult.rows.map((row: any) => ({
        id: `struct_${row.id}`,
        type: 'structure',
        data: { 
          label: `${row.label} (${row.narrator_role})`,
          pattern: row.canonical_pattern_key 
        },
      })),
    ];

    const edges = pairResult.rows.map((row: any) => ({
      id: `e_${row.topic_card_id}_${row.structure_card_id}`,
      source: `topic_${row.topic_card_id}`,
      target: `struct_${row.structure_card_id}`,
      label: String(row.pair_count),
      weight: row.pair_count,
    }));

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error('Database error in graph API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
