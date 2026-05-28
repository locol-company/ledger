import OpusScript from 'opusscript';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

const WHISPER_URL = process.env.WHISPER_URL ?? 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

export async function transcribeOpus(packets: Buffer[]): Promise<string> {
  if (packets.length < 20) return '';

  const decoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  const pcmChunks: Buffer[] = [];

  for (const packet of packets) {
    try {
      pcmChunks.push(Buffer.from(decoder.decode(packet)));
    } catch {
      // skip corrupted packet
    }
  }

  decoder.delete();

  if (pcmChunks.length === 0) return '';

  const wav = buildWav(Buffer.concat(pcmChunks), SAMPLE_RATE, CHANNELS);
  return callWhisper(wav);
}

function buildWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                         // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28); // bytes/sec
  header.writeUInt16LE(channels * 2, 32);              // block align
  header.writeUInt16LE(16, 34);                        // bits/sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function callWhisper(wav: Buffer): Promise<string> {
  if (!OPENAI_API_KEY && WHISPER_URL === 'https://api.openai.com/v1/audio/transcriptions') {
    throw new Error('OPENAI_API_KEY is not set — transcription skipped');
  }

  const form = new FormData();
  // Cast required: Buffer.buffer is typed ArrayBufferLike but is always ArrayBuffer at runtime
  const wavView = new Uint8Array(wav.buffer as ArrayBuffer, wav.byteOffset, wav.byteLength);
  form.append('file', new Blob([wavView], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', 'whisper-1');

  const lang = process.env.WHISPER_LANG;
  if (lang) form.append('language', lang);

  const headers: Record<string, string> = {};
  if (OPENAI_API_KEY) headers['Authorization'] = `Bearer ${OPENAI_API_KEY}`;

  const res = await fetch(WHISPER_URL, { method: 'POST', headers, body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whisper ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { text?: string };
  return filterHallucinations(data.text ?? '');
}

// Whisper hallucinates these phrases on near-silence or very short audio.
// Strip them so they don't pollute the transcript.
const HALLUCINATION_PATTERNS = [
  /โปรดติดตามตอนต่อไป/g,
  /ขอบคุณที่รับชม/g,
  /ติดตามได้ที่/g,
  /กดติดตาม/g,
  /สมัครสมาชิก/g,
];

function filterHallucinations(text: string): string {
  let out = text;
  for (const pattern of HALLUCINATION_PATTERNS) out = out.replace(pattern, '');
  return out.trim();
}
