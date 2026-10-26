import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiskStorageProvider } from '../src/integrations/storage/storage';
import { FfmpegTranscoder } from '../src/integrations/video/transcoder';

/**
 * O conversor de verdade (E45), com o ffmpeg de verdade. Os outros testes usam
 * o conversor falso; este prova que o COMANDO faz o que o comentário promete:
 * corta em 60 s, desvira o vídeo do iPhone, entrega H.264 que toca em tudo.
 *
 * Precisa de um ffmpeg: `FFMPEG_TEST_PATH=/caminho/do/ffmpeg`. Sem ele o teste
 * é pulado (e diz por quê) — o Docker de produção instala o ffmpeg do apt.
 */
const ffmpeg = process.env.FFMPEG_TEST_PATH;

describe.skipIf(!ffmpeg)('conversão de vídeo com ffmpeg (FFMPEG_TEST_PATH)', () => {
  let pasta: string;
  let storage: DiskStorageProvider;
  let transcoder: FfmpegTranscoder;

  /** Gera um vídeo sintético com o próprio ffmpeg e põe no storage. */
  function gerar(chave: string, args: string[]): void {
    const destino = storage.localPath(chave);
    execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args, destino]);
    writeFileSync(`${destino}.meta`, JSON.stringify({ mimeType: 'video/quicktime' }));
  }

  /** O que o ffmpeg diz do arquivo pronto (ele lista os streams no stderr). */
  function descrever(chave: string): string {
    try {
      execFileSync(ffmpeg!, ['-hide_banner', '-i', storage.localPath(chave)], { stdio: 'pipe' });
      return '';
    } catch (erro) {
      // sem arquivo de saída o ffmpeg sai com erro, mas já descreveu a entrada
      return String((erro as { stderr: Buffer }).stderr);
    }
  }

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 'oficinaos-ffmpeg-teste-'));
    storage = new DiskStorageProvider('segredo-de-teste', pasta);
    transcoder = new FfmpegTranscoder(ffmpeg!);
    execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(join(pasta, 'videos'))}, { recursive: true })`]);
  });
  afterAll(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('vídeo em pé de 65 s (webm do Android): corta em 60, H.264 720 de altura máxima 1280, índice no começo', async () => {
    gerar('videos/em-pe.original', [
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '65', '-c:v', 'libvpx', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-f', 'webm',
    ]);
    const resultado = await transcoder.transcode({
      storage,
      sourceKey: 'videos/em-pe.original',
      videoKey: 'videos/em-pe.mp4',
      posterKey: 'videos/em-pe.jpg',
    });
    expect(resultado.durationSeconds).toBe(60);

    const info = descrever('videos/em-pe.mp4');
    expect(info).toMatch(/Video: h264 \(High\)/);
    expect(info).toMatch(/720x1280/);
    expect(info).toMatch(/Audio: aac/);
    expect(info).toMatch(/Duration: 00:01:00/);

    // +faststart: o índice (moov) vem antes dos dados (mdat), e o vídeo toca
    // antes de baixar inteiro
    const bytes = readFileSync(storage.localPath('videos/em-pe.mp4'));
    expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));

    expect(await storage.head('videos/em-pe.mp4')).toMatchObject({ mimeType: 'video/mp4', sizeBytes: resultado.sizeBytes });
    expect(await storage.head('videos/em-pe.jpg')).toMatchObject({ mimeType: 'image/jpeg' });
  }, 120_000);

  it('iPhone: HEVC deitado com rotação de 90° no metadado sai H.264 EM PÉ, sem rotação pendurada', async () => {
    const semRotacao = join(pasta, 'iphone-sem-rotacao.mov');
    execFileSync(ffmpeg!, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '2',
      '-c:v', 'libx265', '-tag:v', 'hvc1', semRotacao,
    ]);
    // é assim que o iPhone grava em pé: a imagem deitada e um "gire 90°" no arquivo
    execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', semRotacao, '-c', 'copy', '-f', 'mov', storage.localPath('videos/iphone.original')]);
    writeFileSync(`${storage.localPath('videos/iphone.original')}.meta`, JSON.stringify({ mimeType: 'video/quicktime' }));

    await transcoder.transcode({ storage, sourceKey: 'videos/iphone.original', videoKey: 'videos/iphone.mp4', posterKey: 'videos/iphone.jpg' });
    const info = descrever('videos/iphone.mp4');
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/720x1280/);
    expect(info).not.toMatch(/rotation/);
  }, 120_000);

  it('vídeo sem som (alguns aparelhos gravam assim) converte do mesmo jeito', async () => {
    gerar('videos/mudo.original', ['-f', 'lavfi', '-i', 'testsrc2=size=1921x1081:rate=30', '-t', '2', '-c:v', 'mpeg4', '-f', 'mp4']);
    const resultado = await transcoder.transcode({ storage, sourceKey: 'videos/mudo.original', videoKey: 'videos/mudo.mp4', posterKey: 'videos/mudo.jpg' });
    expect(resultado.durationSeconds).toBe(2);
    const info = descrever('videos/mudo.mp4');
    // medida ímpar de entrada vira par (o H.264 exige)
    expect(info).toMatch(/1280x720/);
    expect(info).not.toMatch(/Audio:/);
  }, 120_000);

  it('arquivo que não é vídeo: a conversão falha (e a fila marca FAILED)', async () => {
    writeFileSync(storage.localPath('videos/lixo.original'), 'isto não é um vídeo');
    writeFileSync(`${storage.localPath('videos/lixo.original')}.meta`, JSON.stringify({ mimeType: 'video/mp4' }));
    await expect(
      transcoder.transcode({ storage, sourceKey: 'videos/lixo.original', videoKey: 'videos/lixo.mp4', posterKey: 'videos/lixo.jpg' }),
    ).rejects.toThrow(/ffmpeg saiu com/);
    expect(await storage.head('videos/lixo.mp4')).toBeNull();
  });
});

describe.runIf(!ffmpeg)('conversão de vídeo com ffmpeg', () => {
  it.skip('pulado: defina FFMPEG_TEST_PATH para rodar com o ffmpeg de verdade', () => {});
});
