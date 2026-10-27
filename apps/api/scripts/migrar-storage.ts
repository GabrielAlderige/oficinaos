/**
 * Leva as fotos e os vídeos do disco do servidor para o balde S3 (Cloudflare R2).
 *
 * Roda no servidor, dentro do container da API (que enxerga o volume `storage`),
 * com as chaves S3_* já no .env — o passo a passo está em docs/DEPLOY.md,
 * §8.4 "Fotos e vídeos no R2":
 *
 *   docker compose run --rm api node dist/migrar-storage.js
 *
 * Lê sempre do disco (o volume), seja qual for o STORAGE_DRIVER.
 *
 * Pode rodar de novo sem medo: o que já foi é pulado. Não apaga nada do disco.
 * Sai com erro se algum arquivo não foi.
 */
import { readEnv } from '../src/config/env';
import { loadEnv } from '../src/config/load-env';
import { copiarDoDisco } from '../src/integrations/storage/mudar-de-lugar';
import { DiskStorageProvider, S3StorageProvider, s3ConfigFromEnv } from '../src/integrations/storage/storage';

loadEnv();
const env = readEnv();
const config = s3ConfigFromEnv(env);
const origem = new DiskStorageProvider(env.JWT_SECRET, env.STORAGE_DIR);
const destino = new S3StorageProvider(env.JWT_SECRET, config);

console.log(`Copiando ${env.STORAGE_DIR} para o balde ${config.bucket} (${config.endpoint})…`);
const resultado = await copiarDoDisco(origem, env.STORAGE_DIR, destino, (chave) => console.log(`  ok  ${chave}`));
console.log(
  `\nCopiados: ${resultado.copiados} (${(resultado.bytes / 1024 / 1024).toFixed(1)} MB). Já estavam no balde: ${resultado.jaEstavam}.`,
);
for (const falha of resultado.falhas) console.log(`  FALHOU  ${falha.chave}: ${falha.motivo}`);
if (resultado.falhas.length) {
  console.log(`\n${resultado.falhas.length} arquivo(s) não foram. NÃO troque o STORAGE_DRIVER ainda.`);
  process.exit(1);
}
console.log('\nTudo no balde. Pode trocar o STORAGE_DRIVER para s3.');
