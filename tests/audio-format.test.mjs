import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBuffer } from 'music-metadata';
import { downloadAudio } from '../server/downloader.mjs';

test('ADTS AAC is rejected rather than saved under an MP3 extension', async t => {
  const audio = await readFile(new URL('./fixtures/unsupported-aac.aac', import.meta.url));
  const metadata = await parseBuffer(audio, { mimeType: 'audio/aac' }, { duration: true });
  assert.match(metadata.format.container, /ADTS/);
  assert.equal(metadata.format.codec, 'AAC');
  assert.ok(metadata.format.duration > 0);
  t.mock.method(globalThis, 'fetch', async () => new Response(audio, {
    headers: { 'Content-Type': 'audio/aac', 'Content-Length': String(audio.length) },
  }));
  const dir = await mkdtemp(join(tmpdir(), 'clear-audio-format-test-'));
  try {
    await assert.rejects(downloadAudio({
      url: 'https://fixture.example/unsupported.aac',
      dest: join(dir, 'audio.part'),
      allowLocal: true,
    }), /音频|格式|不支持/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
