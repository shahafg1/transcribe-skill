#!/usr/bin/env npx ts-node
/**
 * Transcribe audio/video to SRT using ElevenLabs Scribe v3 (scribe_v2 kept as fallback)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { program } from 'commander';

// Load scripts/.env regardless of the current working directory, then fall back to cwd/.env
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

const SUPPORTED_MODELS = ['scribe_v3', 'scribe_v2'] as const;
type ModelId = (typeof SUPPORTED_MODELS)[number];

const MAX_KEYTERMS = 1000;
const MAX_KEYTERM_CHARS = 50;
const MAX_KEYTERM_WORDS = 5;
const KEYTERM_FORBIDDEN = /[<>{}\[\]\\]/;

type TokenType = 'word' | 'spacing' | 'audio_event';

interface Word {
  word: string;
  start: number;
  end: number;
  type: TokenType;
  speakerId?: string;
}

interface TranscriptResult {
  text: string;
  words: Word[];
  duration: number;
  language: string;
  raw: any;
  nativeSrt?: string;
}

interface SubtitleEntry {
  index: number;
  start: number;
  end: number;
  text: string;
}

interface TranscribeOptions {
  model: ModelId;
  language?: string;
  diarize: boolean;
  numSpeakers?: number;
  keyterms: string[];
  audioEvents: boolean;
  nativeSrt: boolean;
}

function secondsToSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

function parseKeyterms(inline?: string, filePath?: string): string[] {
  const raw: string[] = [];
  if (inline) raw.push(...inline.split(','));
  if (filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`Keyterms file not found: ${filePath}`);
    // One term per line; commas on a line also separate terms. Lines starting with # are comments.
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      raw.push(...line.split(','));
    }
  }
  const terms = [...new Set(raw.map(t => t.trim()).filter(Boolean))];

  if (terms.length > MAX_KEYTERMS) {
    throw new Error(`Too many keyterms: ${terms.length} (max ${MAX_KEYTERMS})`);
  }
  for (const t of terms) {
    if (t.length > MAX_KEYTERM_CHARS) throw new Error(`Keyterm longer than ${MAX_KEYTERM_CHARS} chars: "${t}"`);
    if (t.split(/\s+/).length > MAX_KEYTERM_WORDS) throw new Error(`Keyterm has more than ${MAX_KEYTERM_WORDS} words: "${t}"`);
    if (KEYTERM_FORBIDDEN.test(t)) throw new Error(`Keyterm contains a forbidden character (< > { } [ ] \\): "${t}"`);
  }
  return terms;
}

async function transcribe(inputPath: string, opts: TranscribeOptions): Promise<TranscriptResult> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not set (scripts/.env or environment variable)');
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  console.log(`Transcribing: ${path.basename(inputPath)}`);
  console.log(`Model: ${opts.model}`);
  console.log(`Language: ${opts.language || 'auto-detect'}`);
  if (opts.diarize) console.log(`Diarization: on${opts.numSpeakers ? ` (max ${opts.numSpeakers} speakers)` : ''}`);
  if (opts.keyterms.length) console.log(`Keyterms: ${opts.keyterms.length} (adds ~20% to the transcription cost)`);
  if (opts.audioEvents) console.log('Audio events: tagged');

  const formData = new FormData();
  const fileBuffer = fs.readFileSync(inputPath);
  const blob = new Blob([fileBuffer]);
  formData.append('file', blob, path.basename(inputPath));
  formData.append('model_id', opts.model);
  formData.append('tag_audio_events', opts.audioEvents ? 'true' : 'false');

  if (opts.language) {
    formData.append('language_code', opts.language);
  }
  if (opts.diarize) {
    formData.append('diarize', 'true');
    if (opts.numSpeakers) formData.append('num_speakers', String(opts.numSpeakers));
  }
  // keyterms is a list field: one form entry per term
  for (const term of opts.keyterms) {
    formData.append('keyterms', term);
  }
  if (opts.nativeSrt) {
    formData.append('additional_formats', JSON.stringify([{ format: 'srt', include_speakers: opts.diarize }]));
  }

  const t0 = Date.now();
  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/speech-to-text`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as any;
  const elapsed = (Date.now() - t0) / 1000;

  const words: Word[] = (result.words || []).map((w: any) => ({
    word: w.text ?? w.word ?? '',
    start: w.start ?? 0,
    end: w.end ?? 0,
    type: (w.type as TokenType) || 'word',
    speakerId: w.speaker_id ?? undefined,
  }));

  const spoken = words.filter(w => w.type === 'word');
  const duration = result.audio_duration_secs ?? (spoken.length > 0 ? Math.max(...spoken.map(w => w.end)) : 0);

  let nativeSrt: string | undefined;
  if (opts.nativeSrt) {
    const fmt = (result.additional_formats || []).find((f: any) => f && f.requested_format === 'srt');
    if (!fmt) throw new Error('Native SRT was requested but not returned by the API');
    nativeSrt = fmt.is_base64_encoded ? Buffer.from(fmt.content, 'base64').toString('utf-8') : fmt.content;
  }

  console.log(`Done: ${spoken.length} words, ${Number(duration).toFixed(1)}s audio, ${elapsed.toFixed(1)}s API time`);

  return {
    text: result.text || '',
    words,
    duration,
    language: result.language_code || opts.language || 'unknown',
    raw: result,
    nativeSrt,
  };
}

const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;

function speakerLabel(speakerId: string, language: string): string {
  const m = /(\d+)$/.exec(speakerId);
  const n = m ? parseInt(m[1], 10) + 1 : speakerId;
  // A Hebrew label keeps the cue's first strong character RTL, so players lay out Hebrew lines right-to-left
  const isHebrew = /^(he|heb|iw)$/i.test(language);
  return isHebrew ? `דובר ${n}: ` : `Speaker ${n}: `;
}

function generateSrt(
  words: Word[],
  options: {
    maxWords: number;
    maxDuration: number;
    maxChars: number;
    timingOffset: number;
    includeAudioEvents: boolean;
    diarize: boolean;
    language: string;
  }
): SubtitleEntry[] {
  // Only real words (and audio events if asked for). Spacing tokens are dropped; punctuation is
  // already attached to the word token, and stray punctuation-only tokens are glued to the previous word.
  const tokens: Word[] = [];
  for (const w of words) {
    if (w.type === 'spacing') continue;
    if (w.type === 'audio_event' && !options.includeAudioEvents) continue;
    const text = w.word.trim();
    if (!text) continue;
    if (w.type === 'word' && PUNCT_ONLY.test(text) && tokens.length > 0) {
      const prev = tokens[tokens.length - 1];
      prev.word += text;
      prev.end = Math.max(prev.end, w.end);
      continue;
    }
    tokens.push({ ...w, word: text });
  }

  const entries: SubtitleEntry[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const body = current.map(w => w.word).join(' ').trim();
    if (body) {
      const label = options.diarize && current[0].speakerId ? speakerLabel(current[0].speakerId, options.language) : '';
      const start = current[0].start + options.timingOffset;
      let end = current[current.length - 1].end + options.timingOffset;
      if (end <= start) end = start + 0.1; // never emit zero/negative-length cues
      entries.push({ index: entries.length + 1, start, end, text: label + body });
    }
    current = [];
  };

  for (const word of tokens) {
    if (current.length > 0) {
      const testText = [...current.map(w => w.word), word.word].join(' ');
      const entryDuration = word.end - current[0].start;
      const speakerChanged = options.diarize && word.speakerId !== current[current.length - 1].speakerId;

      const shouldBreak =
        speakerChanged ||
        testText.length > options.maxChars ||
        entryDuration > options.maxDuration ||
        current.length >= options.maxWords;

      if (shouldBreak) flush();
    }
    current.push(word);
  }
  flush();

  // Keep cues from overlapping the next one (can happen after the minimum-length fix)
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i].end > entries[i + 1].start) entries[i].end = Math.max(entries[i].start + 0.01, entries[i + 1].start);
  }

  return entries;
}

function writeSrt(entries: SubtitleEntry[], outputPath: string): void {
  const lines: string[] = [];

  for (const entry of entries) {
    lines.push(entry.index.toString());
    lines.push(`${secondsToSrtTime(entry.start)} --> ${secondsToSrtTime(entry.end)}`);
    lines.push(entry.text);
    lines.push('');
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`Written: ${outputPath} (${entries.length} entries)`);
}

async function main() {
  program
    .requiredOption('-i, --input <path>', 'Input audio/video file')
    .requiredOption('-o, --output <path>', 'Output SRT file path')
    .option('-m, --model <id>', 'Model: scribe_v3 (default) or scribe_v2 (fallback)', 'scribe_v3')
    .option('-l, --language <code>', 'Language code (en, he, ar, etc.)')
    .option('--diarize', 'Detect speakers; label cues and start a new cue on speaker change')
    .option('--speakers <n>', 'Max number of speakers, 1-32 (implies --diarize)')
    .option('--keyterms <list>', 'Comma-separated terms to bias recognition (adds ~20% cost)')
    .option('--keyterms-file <path>', 'File with keyterms, one per line (adds ~20% cost)')
    .option('--audio-events', 'Tag audio events like (laughter) and include them in the SRT')
    .option('--native-srt', "Use ElevenLabs' own SRT export instead of the local SRT builder")
    .option('--max-words <n>', 'Max words per subtitle', '5')
    .option('--max-duration <s>', 'Max duration per subtitle in seconds', '3.0')
    .option('--max-chars <n>', 'Max characters per subtitle', '70')
    .option('--timing-offset <s>', 'Timing offset in seconds', '0.25')
    .option('--json', 'Also output the raw API response JSON')
    .parse();

  const opts = program.opts();

  try {
    if (!SUPPORTED_MODELS.includes(opts.model)) {
      throw new Error(`Unsupported --model "${opts.model}". Use one of: ${SUPPORTED_MODELS.join(', ')}`);
    }

    let numSpeakers: number | undefined;
    if (opts.speakers !== undefined) {
      numSpeakers = Number(opts.speakers);
      if (!Number.isInteger(numSpeakers) || numSpeakers < 1 || numSpeakers > 32) {
        throw new Error(`--speakers must be an integer between 1 and 32 (got "${opts.speakers}")`);
      }
    }
    const diarize = Boolean(opts.diarize) || numSpeakers !== undefined;
    const keyterms = parseKeyterms(opts.keyterms, opts.keytermsFile);

    const transcript = await transcribe(opts.input, {
      model: opts.model,
      language: opts.language,
      diarize,
      numSpeakers,
      keyterms,
      audioEvents: Boolean(opts.audioEvents),
      nativeSrt: Boolean(opts.nativeSrt),
    });

    if (transcript.nativeSrt !== undefined) {
      fs.writeFileSync(opts.output, transcript.nativeSrt, 'utf-8');
      console.log(`Written: ${opts.output} (native ElevenLabs SRT)`);
    } else {
      const entries = generateSrt(transcript.words, {
        maxWords: parseInt(opts.maxWords),
        maxDuration: parseFloat(opts.maxDuration),
        maxChars: parseInt(opts.maxChars),
        timingOffset: parseFloat(opts.timingOffset),
        includeAudioEvents: Boolean(opts.audioEvents),
        diarize,
        language: transcript.language,
      });
      writeSrt(entries, opts.output);
    }

    if (opts.json) {
      const jsonPath = opts.output.replace(/\.srt$/i, '') + '_transcript.json';
      fs.writeFileSync(jsonPath, JSON.stringify(transcript.raw, null, 2), 'utf-8');
      console.log(`Written: ${jsonPath}`);
    }

    console.log('\n✓ Transcription complete!');
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
