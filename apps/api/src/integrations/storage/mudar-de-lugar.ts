import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { DiskStorageProvider, StorageProvider } from './storage';

export interface ResultadoDaCopia {
  copiados: number;
  jaEstavam: number;
  bytes: number;
  falhas: { chave: string; motivo: string }[];
}

/** Todas as chaves da pasta do driver disk (o `.meta` vai junto do arquivo, não é chave). */
export async function chavesDoDisco(pasta: string): Promise<string[]> {
  const chaves: string[] = [];
  async function andar(atual: string): Promise<void> {
    for (const entrada of await readdir(atual, { withFileTypes: true })) {
      const caminho = join(atual, entrada.name);
      if (entrada.isDirectory()) await andar(caminho);
      else if (!entrada.name.endsWith('.meta')) chaves.push(relative(pasta, caminho).split(sep).join('/'));
    }
  }
  await andar(pasta);
  return chaves.sort();
}

/**
 * Copia os arquivos do disco do servidor para o balde (a mudança para o R2).
 * Pode rodar quantas vezes precisar: o que já está lá com o mesmo tamanho e
 * tipo é pulado. Cada cópia é conferida lendo de volta o tamanho e o tipo.
 * NÃO apaga nada do disco: é ele que permite voltar atrás.
 */
export async function copiarDoDisco(
  origem: DiskStorageProvider,
  pasta: string,
  destino: StorageProvider,
  aoCopiar: (chave: string) => void = () => {},
): Promise<ResultadoDaCopia> {
  const resultado: ResultadoDaCopia = { copiados: 0, jaEstavam: 0, bytes: 0, falhas: [] };
  for (const chave of await chavesDoDisco(pasta)) {
    try {
      const local = await origem.head(chave);
      // sem `.meta` o arquivo nunca terminou de subir: não é anexo de ninguém
      if (!local) {
        resultado.falhas.push({ chave, motivo: 'sem o tipo do arquivo (.meta): envio que não terminou' });
        continue;
      }
      const la = await destino.head(chave);
      if (la && la.sizeBytes === local.sizeBytes && la.mimeType === local.mimeType) {
        resultado.jaEstavam += 1;
        continue;
      }
      const objeto = await origem.stream(chave);
      await destino.putStream(chave, objeto!.body, local.mimeType, local.sizeBytes);
      const conferido = await destino.head(chave);
      if (!conferido || conferido.sizeBytes !== local.sizeBytes || conferido.mimeType !== local.mimeType) {
        resultado.falhas.push({ chave, motivo: 'a cópia não bateu com o original' });
        continue;
      }
      resultado.copiados += 1;
      resultado.bytes += local.sizeBytes;
      aoCopiar(chave);
    } catch (erro) {
      resultado.falhas.push({ chave, motivo: erro instanceof Error ? erro.message : String(erro) });
    }
  }
  return resultado;
}
