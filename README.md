# transcribe: a Claude Code skill for ElevenLabs Scribe v3

Turn audio or video into SRT subtitles with [ElevenLabs Scribe v3](https://elevenlabs.io/blog/scribe-v3), with Scribe v2 kept as a fallback.
Works well for Hebrew and other right-to-left languages.

- Word-level SRT builder (spacing tokens dropped, punctuation kept, no empty, zero-length or overlapping cues)
- Speaker diarization (up to 32 speakers) with per-cue speaker labels
- Keyterm prompting (up to 1,000 terms) for names and jargon
- Optional audio-event tags and ElevenLabs' own SRT export

## Install

```bash
git clone https://github.com/shahafg1/transcribe-skill.git ~/.claude/skills/transcribe
cd ~/.claude/skills/transcribe/scripts
npm install
cp .env.example .env   # then put your ElevenLabs API key in .env
```

You can also set `ELEVENLABS_API_KEY` as an environment variable instead of using `.env`.
Requires Node.js 18+ (uses the built-in `fetch`).

## Usage

In Claude Code, ask for a transcription or subtitles and the skill is picked up automatically. You can also run it directly:

```bash
cd ~/.claude/skills/transcribe/scripts
npx ts-node transcribe.ts -i meeting.mp4 -o meeting.srt -l he --diarize
```

See [skill.md](skill.md) for every option.

## Pricing (ElevenLabs)

$0.20 per audio hour for Scribe v3 and v2. Keyterms add about 20% to that.

## License

MIT
