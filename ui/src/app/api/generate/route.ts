import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: Request) {
  try {
    const { clientId, count = 1, niche, topic, angle, mode = 'rewrite', topicId, structureId } = await request.json();

    if (!clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }

    // Path to the python script relative to the project root
    const scriptPath = path.resolve(process.cwd(), '..', 'services', 'v1', 'automation', 'batch_generator.py');
    const pythonPath = 'python3'; // Assuming python3 is in the path

    console.log(`Starting batch generation for client ${clientId}, count ${count}`);

    // Execute the script
    const pythonProcess = spawn(pythonPath, [
      scriptPath,
      '--count', count.toString(),
      '--client_id', clientId.toString(),
      ...(niche ? ['--niche', niche] : []),
      ...(topic ? ['--topic', topic] : []),
      ...(angle ? ['--angle', angle] : []),
      ...(mode ? ['--mode', mode] : []),
      ...(topicId ? ['--topic_id', topicId.toString()] : []),
      ...(structureId ? ['--structure_id', structureId.toString()] : []),
      '--generation_source', 'manual'
    ], {
      cwd: path.resolve(process.cwd(), '..'),
      env: { ...process.env, PYTHONPATH: '.' }
    });

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      output += msg;
      console.log(`[Python STDOUT]: ${msg}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      errorOutput += msg;
      console.error(`[Python STDERR]: ${msg}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
    });

    // We don't wait for completion if it's a long process, 
    // but for now let's return a "started" response or wait briefly
    
    return NextResponse.json({ 
      message: 'Batch generation started', 
      job: { clientId, count, niche, topic, angle, mode } 
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Failed to start generation' }, { status: 500 });
  }
}
