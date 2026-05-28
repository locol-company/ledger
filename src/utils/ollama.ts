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

  const prompt = `You are a project assistant. Summarize the Discord activity below for the "${categoryName}" project category (${fromStr} → ${toStr} ICT). Write the entire summary in Thai language.

${body}

Write a daily summary using EXACTLY this format (no deviations):

**What happened**
• bullet point
• bullet point

**Action items**
• bullet point
• (write "• None" if absent)

**Notable**
• bullet point
• (write "• None" if absent)

Rules:
- Cover EVERY distinct topic, decision, update, and action item mentioned — do not omit anything
- If there are 10 things that happened, list all 10
- Use "**text**" (double asterisks) for the three section headers exactly as shown above
- Use "•" (bullet character) for every list item, never "-" or any "#" headings
- Never add a date line or title — the embed already has one
- Do not repeat raw messages verbatim, but do not lose any information
- Language: write in Thai, but NEVER translate, transliterate, or convert any proper noun into Thai script — this includes Discord usernames, person names, company names, product names, brand names, technical terms, and acronyms. They must appear character-for-character exactly as written in the source (e.g. "nontapan" stays "nontapan" not "นงตาปัน", "SPAR6C" stays "SPAR6C", "EXIM Bank" stays "EXIM Bank")`;

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

export async function summarizeMaster(
  projects: { name: string; summary: string }[],
  fromTime: Date,
  toTime: Date,
): Promise<string> {
  const fromStr = formatICT(fromTime);
  const toStr = formatICT(toTime);

  const body = projects
    .map((p) => `### ${p.name}\n${p.summary}`)
    .join('\n\n');

  const prompt = `You are a project assistant writing a cross-project daily overview for an organisation (${fromStr} → ${toStr} ICT). Write the entire summary in Thai language.

Below are the individual summaries for each project category:

${body}

Write a brief cross-project overview using EXACTLY this format:

One project per section. For each project write 2–4 bullet points that cover what happened, key decisions, and action items. Do not skip any project. Do not skip any significant point from the summaries above.

**{Project Name}**
• key point
• key point

Rules:
- Replace {Project Name} with the actual category name in bold
- Use "**text**" (double asterisks) for every project header exactly as shown
- Use "•" for every bullet, never "-" or any "#" headings
- Never add a date line or intro paragraph — start directly with the first project
- Cover all projects, no matter how small their activity
- Language: write in Thai, but NEVER translate, transliterate, or convert any proper noun into Thai script — Discord usernames, person names, company names, product names, brand names, technical terms, and acronyms must appear character-for-character exactly as written in the source`;

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

export interface TranscriptEntry {
  timestamp: Date;
  username: string;
  displayName: string;
  text: string;
}

export async function summarizeMeeting(
  transcript: TranscriptEntry[],
  participants: Map<string, string>,
  fromTime: Date,
  toTime: Date,
): Promise<string> {
  const fromStr = formatICT(fromTime);
  const toStr = formatICT(toTime);
  const participantList = [...participants.values()].join(', ');

  const lines = transcript
    .map((e) => `[${formatICT(e.timestamp)}] ${e.displayName}: ${e.text}`)
    .join('\n');

  const prompt = `You are a meeting assistant. Summarize the following meeting transcript (${fromStr} → ${toStr} ICT). Write the entire summary in Thai language.

Participants: ${participantList}

Transcript:
${lines}

Write a meeting summary using EXACTLY this format (no deviations):

**สิ่งที่หารือ**
• bullet point
• bullet point

**มติ / การตัดสินใจ**
• bullet point
• (write "• ไม่มี" if none)

**Action Items**
• bullet point
• (write "• ไม่มี" if none)

Rules:
- Cover ALL topics discussed — do not omit anything
- Use "•" (bullet character) for every list item, never "-" or any "#" headings
- Never add a date line or title
- Language: write in Thai, but NEVER translate, transliterate, or convert any proper noun into Thai script — Discord usernames, person names, company names, product names, technical terms must appear exactly as in the source`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { response: string };
  return data.response.trim();
}
