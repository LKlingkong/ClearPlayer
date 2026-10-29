import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('Windows 启动文件在中文与空格目录下完整执行，不把提示文字当成命令', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clear-launcher-'));
  const project = path.join(root, '播放器 测试目录');
  const bin = path.join(root, 'bin');
  await mkdir(project, {recursive:true});
  await mkdir(bin);
  await mkdir(path.join(project, 'node_modules/vite/bin'), {recursive:true});
  await mkdir(path.join(project, 'dist'));
  await writeFile(path.join(project, 'dist/index.html'), '');
  await writeFile(path.join(project, 'node_modules/vite/bin/vite.js'), '');
  await writeFile(path.join(bin, 'node.cmd'), '@echo off\r\nexit /b 0\r\n', 'ascii');
  await writeFile(path.join(bin, 'npm.cmd'), '@echo off\r\necho NPM_ARGS:%*\r\necho NPM_CWD:%CD%\r\nexit /b 0\r\n', 'ascii');
  await writeFile(path.join(project, 'start-player.cmd'), await readFile(new URL('../start-player.cmd', import.meta.url)));
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d','/c','start-player.cmd'], {
    cwd:project,
    env:{...process.env, PATH:`${bin};${process.env.PATH || process.env.Path}`},
    encoding:'utf8', input:'\r\n', timeout:10000, windowsHide:true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /NPM_ARGS:start -- --open/, output);
  assert.match(output, /NPM_CWD:.*播放器 测试目录/, output);
  assert.doesNotMatch(output, /不是内部或外部命令|not recognized/i);
});
