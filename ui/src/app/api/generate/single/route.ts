import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

/**
 * API Route to trigger generation for a single reference.
 */
export async function POST(request: Request) {
  try {
    const { contentId, clientId } = await request.json();

    if (!contentId) {
      return NextResponse.json({ error: 'Content ID is required' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'services', 'v1', 'automation', 'single_generator.py');
    const pythonPath = 'python3';

    console.log(`Manual generation triggered for Content ${contentId} (Client: ${clientId})`);

    // Execute the single generator script
    const pythonProcess = spawn(pythonPath, [
      scriptPath,
      '--content_id', contentId.toString(),
      clientId ? '--client_id' : '',
      clientId ? clientId.toString() : '',
      '--generation_source',
      'manual'
    ].filter(Boolean), {
      env: { ...process.env, PYTHONPATH: '..' }
    });

    // In this case, we don't wait for completion to avoid timeout (HeyGen can take 5+ mins)
    // We just ensure the process started correctly
    
    pythonProcess.on('error', (err) => {
      console.error('Failed to start python process:', err);
    });

    return NextResponse.json({ 
      status: 'started',
      message: 'Generation cycle initiated in background',
      contentId 
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
