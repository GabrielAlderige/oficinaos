import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { VIDEO_MAX_SECONDS } from '@oficinaos/shared';
import type { Env } from '../../config/env';
import type { StorageProvider } from '../storage/storage';

export interface TranscodeInput {
  storage: StorageProvider;
  /** o arquivo como veio do aparelho */
  sourceKey: string;
  /** onde gravar o MP4 pronto e a capa */
  videoKey: string;
  posterKey: string;
}

export interface TranscodeResult {
  durationSeconds: number;
  sizeBytes: number;
}

/**
 * Conversão do vídeo da OS (E45) atrás de uma interface, como o storage: o
 * domínio não sabe que existe ffmpeg, e os testes trocam por um conversor que
 * não executa nada.
 */
export interface VideoTranscoder {
  readonly driver: string;
  transcode(input: TranscodeInput): Promise<TranscodeResult>;
}

/** Nenhum vídeo leva mais que isso para converter; passou, o ffmpeg travou. */
const TEMPO_MAXIMO_MS = 10 * 60 * 1000;

/**
 * Por que converter no servidor, e não tocar o arquivo como veio:
 *
 * - o iPhone grava `.mov` em **HEVC**, que o Chrome do Android, o Firefox e boa
 *   parte dos computadores com Windows não tocam. O cliente da oficina abriria
 *   o orçamento e veria um quadro preto;
 * - o Android e o computador gravam `webm` (VP8/VP9), que o Safari antigo do
 *   iPhone não toca;
 * - um minuto de celular tem de 60 a 400 MB. O cliente abre o orçamento no 4G.
 *
 * O MP4 com H.264 e AAC toca em qualquer navegador desde 2012. Com 720p e taxa
 * limitada, um minuto fica em torno de 10 MB. `+faststart` põe o índice no
 * começo do arquivo: o vídeo começa a tocar antes de baixar inteiro.
 *
 * O servidor tem 1 vCPU: o ffmpeg roda com prioridade baixa, com no máximo 2
 * threads e um vídeo por vez (quem enfileira é o `VideoProcessor`), para a
 * API continuar respondendo enquanto ele trabalha.
 */
export class FfmpegTranscoder implements VideoTranscoder {
  readonly driver = 'ffmpeg';

  constructor(private readonly ffmpegPath: string) {}

  async transcode({ storage, sourceKey, videoKey, posterKey }: TranscodeInput): Promise<TranscodeResult> {
    const pasta = await mkdtemp(join(tmpdir(), 'oficinaos-video-'));
    try {
      // o original já está no disco quando o storage é local; senão, baixa
      let origem = storage.localPath(sourceKey);
      if (!origem) {
        const objeto = await storage.stream(sourceKey);
        if (!objeto) throw new Error('O arquivo original sumiu antes da conversão');
        origem = join(pasta, 'original');
        await pipeline(objeto.body, createWriteStream(origem));
      }

      const video = join(pasta, 'video.mp4');
      const capa = join(pasta, 'capa.jpg');

      const saida = await this.rodar([
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        origem,
        // o limite de 60 s vale aqui também: o aviso do painel é conveniência,
        // quem garante é o corte
        '-t',
        String(VIDEO_MAX_SECONDS),
        '-map',
        '0:v:0',
        // vídeo sem som (alguns aparelhos gravam assim) não pode quebrar a conversão
        '-map',
        '0:a:0?',
        // o lado MAIOR vai a no máximo 1280, em pé ou deitado, sempre com
        // medida par (o H.264 exige). A rotação do celular já vem aplicada
        '-vf',
        "scale='if(gt(iw,ih),trunc(min(1280,iw)/2)*2,-2)':'if(gt(iw,ih),-2,trunc(min(1280,ih)/2)*2)',format=yuv420p",
        '-fpsmax',
        '30',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '27',
        '-maxrate',
        '2500k',
        '-bufsize',
        '5000k',
        '-profile:v',
        'high',
        '-level',
        '4.0',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-threads',
        '2',
        video,
      ]);

      // a capa: o que o iPhone mostra antes do play (sem ela, quadro preto)
      try {
        await this.rodar(['-hide_banner', '-nostdin', '-y', '-ss', '0.5', '-i', video, '-frames:v', '1', '-q:v', '4', capa]);
      } catch {
        // vídeo de menos de meio segundo: o primeiro quadro serve
        await this.rodar(['-hide_banner', '-nostdin', '-y', '-i', video, '-frames:v', '1', '-q:v', '4', capa]);
      }

      const sizeBytes = await storage.putStream(videoKey, createReadStream(video), 'video/mp4', Number.MAX_SAFE_INTEGER);
      await storage.putStream(posterKey, createReadStream(capa), 'image/jpeg', Number.MAX_SAFE_INTEGER);
      return { durationSeconds: duracaoDaSaida(saida), sizeBytes };
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  }

  /** Roda o ffmpeg e devolve o que ele escreveu no stderr (é onde ele conta o progresso). */
  private rodar(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const processo = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      if (processo.pid) {
        try {
          // prioridade baixa: a API responde primeiro
          setPriority(processo.pid, 10);
        } catch {
          // sem permissão para mudar a prioridade: converte assim mesmo
        }
      }
      let stderr = '';
      processo.stderr.on('data', (parte: Buffer) => {
        stderr += parte.toString('utf8');
        // só o fim interessa (a duração e o erro); o começo lista os codecs
        if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
      });
      const relogio = setTimeout(() => processo.kill('SIGKILL'), TEMPO_MAXIMO_MS);
      processo.on('error', (erro) => {
        clearTimeout(relogio);
        reject(new Error(`ffmpeg não abriu (${this.ffmpegPath}): ${erro.message}`));
      });
      processo.on('close', (codigo) => {
        clearTimeout(relogio);
        if (codigo === 0) resolve(stderr);
        else reject(new Error(`ffmpeg saiu com ${codigo}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
      });
    });
  }
}

/**
 * A duração do que foi GRAVADO, e não a do original: o último `time=` do
 * progresso. O `Duration:` do cabeçalho é o do arquivo de entrada (antes do
 * corte), e o `webm` do navegador nem traz esse campo.
 */
export function duracaoDaSaida(stderr: string): number {
  const marcas = [...stderr.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const ultima = marcas.at(-1);
  if (!ultima) return 0;
  const segundos = Number(ultima[1]) * 3600 + Number(ultima[2]) * 60 + Number(ultima[3]);
  return Math.min(VIDEO_MAX_SECONDS, Math.max(1, Math.round(segundos)));
}

/**
 * Conversor dos testes: não executa nada. Copia o original como se fosse o
 * MP4, grava uma capa de mentira e devolve a duração combinada. `falhar`
 * simula o arquivo que o ffmpeg não consegue ler.
 */
export class FakeVideoTranscoder implements VideoTranscoder {
  readonly driver = 'fake';
  durationSeconds = 12;
  falhar = false;
  readonly convertidos: string[] = [];
  private portao: Promise<void> | null = null;

  /**
   * Segura a conversão até a função devolvida ser chamada. Sem isso o falso
   * converte na hora, e o teste nunca vê um vídeo EM conversão.
   */
  segurar(): () => void {
    let soltar = () => {};
    this.portao = new Promise((resolve) => {
      soltar = () => {
        this.portao = null;
        resolve();
      };
    });
    return soltar;
  }

  async transcode({ storage, sourceKey, videoKey, posterKey }: TranscodeInput): Promise<TranscodeResult> {
    if (this.portao) await this.portao;
    if (this.falhar) throw new Error('arquivo de vídeo ilegível (simulado)');
    const original = await storage.get(sourceKey);
    if (!original) throw new Error('O arquivo original sumiu antes da conversão');
    await storage.put(videoKey, original.body, 'video/mp4');
    await storage.put(posterKey, Buffer.from('capa'), 'image/jpeg');
    this.convertidos.push(sourceKey);
    return { durationSeconds: this.durationSeconds, sizeBytes: original.body.byteLength };
  }
}

export function createVideoTranscoder(env: Env): VideoTranscoder {
  return new FfmpegTranscoder(env.FFMPEG_PATH);
}
