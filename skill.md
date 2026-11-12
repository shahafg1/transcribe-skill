---
name: transcribe
description: "Transcribe audio/video to SRT subtitles using ElevenLabs Scribe v3 (scribe_v2 fallback), with optional speaker diarization and keyterms. Use for: transcription, subtitles, captions, SRT generation, Hebrew meeting/workshop recordings."
---

# Transcribe

Generate SRT subtitle files from audio/video using ElevenLabs Scribe v3 (`scribe_v3`).
`scribe_v2` is still available as a fallback with `--model scribe_v2`.

## Quick Start

```bash
cd ~/.claude/skills/transcribe/scripts

# Basic transcription (auto-detect language, Scribe v3)
npx ts-node transcribe.ts -i /path/to/video.mp4 -o /path/to/output.srt

# Hebrew, with speaker labels ("דובר 1:", "דובר 2:")
npx ts-node transcribe.ts -i meeting.mp4 -o meeting.srt -l he --diarize

# Known number of speakers (implies --diarize)
npx ts-node transcribe.ts -i meeting.mp4 -o meeting.srt -l he --speakers 3

# Bias recognition toward names/terms (adds ~20% cost)
npx ts-node transcribe.ts -i talk.mp4 -o talk.srt --keyterms "Acme,Claude Code,Kubernetes"
npx ts-node transcribe.ts -i talk.mp4 -o talk.srt --keyterms-file terms.txt

# Fall back to Scribe v2
npx ts-node transcribe.ts -i video.mp4 -o out.srt --model scribe_v2

# Custom subtitle length
npx ts-node transcribe.ts -i video.mp4 -o out.srt --max-words 6 --max-duration 4.0
```

## Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--input` | `-i` | (required) | Input audio/video file |
| `--output` | `-o` | (required) | Output SRT file path |
| `--model` | `-m` | `scribe_v3` | `scribe_v3` or `scribe_v2` (fallback) |
| `--language` | `-l` | auto | Language code (en, he, ar, etc.) |
| `--diarize` | | off | Detect speakers. Each cue gets a speaker label (`דובר N:` for Hebrew, `Speaker N:` otherwise) and a new cue starts when the speaker changes |
| `--speakers` | | auto | Max number of speakers, 1–32 (`num_speakers`). Turns on `--diarize` |
| `--keyterms` | | none | Comma-separated terms/names to bias recognition |
| `--keyterms-file` | | none | File with one term per line (commas also split; `#` lines are comments) |
| `--audio-events` | | off | Tag audio events like `(laughter)` and include them in the SRT |
| `--native-srt` | | off | Use ElevenLabs' own SRT export (`additional_formats`) instead of the local builder |
| `--max-words` | | 5 | Max words per subtitle entry |
| `--max-duration` | | 3.0 | Max seconds per subtitle entry |
| `--max-chars` | | 70 | Max characters per subtitle entry |
| `--timing-offset` | | 0.25 | Timing offset in seconds |
| `--json` | | false | Also write the raw API response (`<output>_transcript.json`) |

Keyterm limits (API): up to 1,000 terms, each ≤ 50 characters and ≤ 5 words, no `< > { } [ ] \`.

## Pricing

- Scribe v3 and Scribe v2: **$0.20 per audio hour** (same price).
- Keyterms: ElevenLabs docs say **+20% surcharge** on the base cost (≈ +$0.04–0.05/hour).
  With more than 100 keyterms there is a 20-second minimum billable duration per request.
- Diarization, audio events and native SRT do not add a documented cost.

## How the SRT is built

The local builder (default) uses only `words[]` entries with `type === "word"`.
`spacing` tokens are dropped, and `audio_event` tokens are dropped unless `--audio-events` is on.
Punctuation comes attached to the word token and stays attached. Cues never have zero length and never overlap.

## Language Codes

- `en` - English
- `he` - Hebrew
- `ar` - Arabic
- `es` - Spanish
- `fr` - French
- `de` - German
- `ru` - Russian
- `zh` - Chinese
- `ja` - Japanese
- (or omit for auto-detection)

## Output

The script generates:
1. `.srt` file - Standard subtitle file (UTF-8)
2. `_transcript.json` (with `--json`) - Raw API response: word-level timestamps, `type`, `speaker_id`, `logprob`

## Environment

The API key is read from `scripts/.env` (from any working directory) or from the `ELEVENLABS_API_KEY` environment variable:
```
ELEVENLABS_API_KEY=your_key_here
```
