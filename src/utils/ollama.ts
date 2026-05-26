const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://192.168.1.39:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

export interface ChannelMessages {
  channelName: string;
  messages: { author: string; content: string; timestamp: string }[];
}

export async function summarizeCategory(
  categoryName: string,
  channels: ChannelMessages[],
  fromTime: Date,
  toTime: Date,
): Promise<string> {
  const totalMessages = channels.reduce((n, c) => n + c.messages.length, 0);
  if (totalMessages === 0) return '_No messages in this period._';

  const fromStr = formatICT(fromTime);
  const toStr = formatICT(toTime);

  const body = channels
    .filter((c) => c.messages.length > 0)
    .map((c) => {
      const lines = c.messages
        .map((m) => `[${m.timestamp}] ${m.author}: ${m.content}`)
        .join('\n');
      return `### #${c.channelName}\n${lines}`;
    })
    .join('\n\n');

  const prompt = `You are a project assistant. Summarize the Discord activity below for the "${categoryName}" project category (${fromStr} → ${toStr} ICT).

${body}

Write a concise daily summary with these sections:
**What happened** — key discussions, updates, and decisions (bullet points)
**Action items** — tasks or follow-ups explicitly or implicitly mentioned (bullet points, or "None" if absent)
**Notable** — anything urgent or time-sensitive (bullet points, or "None" if absent)

Be brief. Use bullet points. Do not repeat raw messages verbatim.`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

function formatICT(date: Date): string {
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ollamaModel(): string {
  return OLLAMA_MODEL;
}
