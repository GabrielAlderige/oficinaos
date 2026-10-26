import { VIDEO_UPLOAD_MIME_TYPES, videoMimeFromFileName, type VideoUploadMimeType } from '@oficinaos/shared';

/**
 * O que o vídeo do defeito (E45) e o vídeo da entrada (E47) dividem: ler a
 * duração antes de subir, saber se o aparelho tem câmera e descobrir o tipo.
 */

/** "0:42", "1:00" */
export const duracao = (segundos: number) => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

/**
 * A duração lida no próprio aparelho, antes de subir: é o que evita esperar
 * 3 minutos de envio para descobrir que o vídeo tinha 2 minutos.
 *
 * `null` quando o navegador não sabe ler (HEVC do iPhone num Chrome de
 * computador, `webm` sem duração no cabeçalho). Aí o vídeo sobe assim mesmo:
 * o servidor corta em 60 s de qualquer jeito.
 */
export function lerDuracao(arquivo: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo);
    const video = document.createElement('video');
    const fim = (valor: number | null) => {
      clearTimeout(relogio);
      URL.revokeObjectURL(url);
      resolve(valor);
    };
    const relogio = setTimeout(() => fim(null), 8000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => fim(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => fim(null);
    video.src = url;
  });
}

/** Celular e tablet: a câmera abre direto. Computador: só escolher o arquivo. */
export const temCamera = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** O tipo do vídeo; o Windows às vezes manda o .mov sem tipo, e a extensão resolve. */
export function tipoDoVideo(arquivo: File): VideoUploadMimeType | null {
  const base = arquivo.type.split(';')[0]!.trim();
  if ((VIDEO_UPLOAD_MIME_TYPES as readonly string[]).includes(base)) return base as VideoUploadMimeType;
  return videoMimeFromFileName(arquivo.name);
}
