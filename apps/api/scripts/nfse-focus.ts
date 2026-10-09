/**
 * Liga (ou desliga) a NFS-e de verdade de UMA oficina, pela Focus NFe.
 *
 * Roda no servidor, dentro do container da API (que tem a SECRETS_KEY):
 *
 *   docker compose exec api node dist/nfse-focus.js ver      --email dono@oficina.com
 *   docker compose exec api node dist/nfse-focus.js ligar    --email dono@oficina.com --token TOKEN --ambiente homologacao
 *   docker compose exec api node dist/nfse-focus.js ligar    --email dono@oficina.com --token TOKEN --ambiente producao
 *   docker compose exec api node dist/nfse-focus.js desligar --email dono@oficina.com
 *
 * Opcionais no `ligar`: `--ibge 3151800` (senão sai da cidade do cadastro da
 * oficina, pela API do IBGE) e `--servico 140101` (senão sai do item 14.01).
 *
 * O passo a passo do dia (conta, certificado, cadastro da empresa na Focus)
 * está em docs/DEPLOY.md, "Nota fiscal de verdade".
 *
 * Por que script e não tela: ligar a nota de verdade é decisão comercial (só
 * no Nitro) e operacional (certificado conferido, homologação feita). Não é
 * um botão que a oficina aperta sozinha.
 */
import { eq, sql } from 'drizzle-orm';
import { readEnv } from '../src/config/env';
import { loadEnv } from '../src/config/load-env';
import { cifrar } from '../src/core/secrets';
import { createDatabase } from '../src/db/client';
import { organizationFiscalSettings } from '../src/db/schema';
import { withTenant, withUser } from '../src/db/tenant';
import * as orgRepo from '../src/modules/organizations/organizations.repository';

loadEnv();

const BASE = { HOMOLOGATION: 'https://homologacao.focusnfe.com.br', PRODUCTION: 'https://api.focusnfe.com.br' } as const;

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const semAcento = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Código IBGE pela cidade e UF do cadastro da oficina. */
async function codigoIbge(cidade: string, uf: string): Promise<string | null> {
  const resposta = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
  if (!resposta.ok) return null;
  const municipios = (await resposta.json()) as { id: number; nome: string }[];
  const achado = municipios.find((m) => semAcento(m.nome) === semAcento(cidade));
  return achado ? String(achado.id) : null;
}

/** O token funciona? Consulta uma nota que não existe: 404 é "entrei", 401 é "token errado". */
async function testarToken(token: string, ambiente: keyof typeof BASE): Promise<void> {
  const resposta = await fetch(`${BASE[ambiente]}/v2/nfsen/oficinaos-teste-de-conexao`, {
    headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` },
  });
  if (resposta.status === 401 || resposta.status === 403) {
    throw new Error(`A Focus NFe recusou o token no ambiente de ${ambiente === 'PRODUCTION' ? 'produção' : 'homologação'}.`);
  }
  if (resposta.status >= 500) throw new Error(`A Focus NFe respondeu ${resposta.status}; tente de novo.`);
}

async function main(): Promise<void> {
  const acao = process.argv[2];
  const email = argumento('email')?.trim().toLowerCase();
  if (!['ver', 'ligar', 'desligar'].includes(acao ?? '') || !email) {
    console.log('Uso: nfse-focus.js ver|ligar|desligar --email dono@oficina.com [--token T --ambiente homologacao|producao]');
    process.exit(1);
  }

  const env = readEnv(process.env);
  const { db, pool } = createDatabase(env.DATABASE_URL, { max: 1 });
  try {
    const { rows: usuarios } = await db.execute<{ id: string }>(sql`select id from users where lower(email) = ${email}`);
    const userId = usuarios[0]?.id;
    if (!userId) throw new Error(`Nenhuma conta com o e-mail ${email}.`);
    const { rows: vinculos } = await withUser(db, userId, (tx) =>
      tx.execute<{ organization_id: string }>(sql`select organization_id from memberships where role = 'OWNER'`),
    );
    if (vinculos.length !== 1) {
      throw new Error(`${email} é dono de ${vinculos.length} oficinas; este script espera exatamente uma.`);
    }
    const organizationId = vinculos[0]!.organization_id;

    await withTenant(db, { organizationId }, async (tx) => {
      const oficina = await orgRepo.findOrganization(tx, organizationId);
      if (!oficina) throw new Error('Oficina não encontrada.');
      const [antes] = await tx
        .select()
        .from(organizationFiscalSettings)
        .where(eq(organizationFiscalSettings.organizationId, organizationId));

      const resumo = (linha: typeof antes) =>
        `${oficina.name} · CNPJ ${oficina.document ?? '(sem CNPJ)'} · ${oficina.address?.city ?? '?'}/${oficina.address?.state ?? '?'}\n` +
        `  emissor: ${linha?.provider ?? 'simulador'} · ambiente: ${linha?.environment ?? 'SIMULATOR'} · token: ${linha?.providerTokenEnc ? 'guardado (cifrado)' : 'não'}\n` +
        `  IBGE: ${linha?.ibgeCityCode ?? '-'} · serviço nacional: ${linha?.nationalServiceCode ?? '(do item ' + (linha?.serviceListItem ?? '14.01') + ')'} · regime: ${linha?.taxRegime ?? '-'} · inscrição municipal: ${linha?.municipalRegistration ?? '-'}`;

      if (acao === 'ver') {
        console.log(resumo(antes));
        return;
      }

      if (acao === 'desligar') {
        await tx
          .insert(organizationFiscalSettings)
          .values({ organizationId, provider: 'simulador', environment: 'SIMULATOR', providerTokenEnc: null })
          .onConflictDoUpdate({
            target: organizationFiscalSettings.organizationId,
            set: { provider: 'simulador', environment: 'SIMULATOR', providerTokenEnc: null, updatedAt: new Date() },
          });
        console.log('Desligado: a oficina volta ao simulador (nada vai para a prefeitura).');
        return;
      }

      const token = argumento('token')?.trim();
      const ambienteTexto = argumento('ambiente');
      if (!token || !['homologacao', 'producao'].includes(ambienteTexto ?? '')) {
        throw new Error('Para ligar: --token TOKEN_DA_EMPRESA_NA_FOCUS --ambiente homologacao|producao');
      }
      const ambiente = ambienteTexto === 'producao' ? 'PRODUCTION' : 'HOMOLOGATION';
      if (!oficina.document) throw new Error('A oficina não tem CNPJ no cadastro: a nota sai no CNPJ dela.');

      let ibge = argumento('ibge') ?? antes?.ibgeCityCode ?? null;
      if (!ibge && oficina.address?.city && oficina.address.state) {
        ibge = await codigoIbge(oficina.address.city, oficina.address.state);
      }
      if (!ibge || !/^\d{7}$/.test(ibge)) {
        throw new Error('Não achei o código IBGE da cidade da oficina. Passe --ibge com os 7 dígitos.');
      }
      const servico = argumento('servico') ?? antes?.nationalServiceCode ?? null;
      if (servico && !/^\d{6}$/.test(servico)) throw new Error('--servico tem 6 dígitos (ex.: 140101).');

      await testarToken(token, ambiente);

      const valores = {
        provider: 'focus',
        environment: ambiente,
        providerTokenEnc: cifrar(token, env.SECRETS_KEY),
        ibgeCityCode: ibge,
        nationalServiceCode: servico,
      } as const;
      await tx
        .insert(organizationFiscalSettings)
        .values({ organizationId, ...valores })
        .onConflictDoUpdate({ target: organizationFiscalSettings.organizationId, set: { ...valores, updatedAt: new Date() } });

      const [depois] = await tx
        .select()
        .from(organizationFiscalSettings)
        .where(eq(organizationFiscalSettings.organizationId, organizationId));
      console.log(`Ligado em ${ambiente === 'PRODUCTION' ? 'PRODUÇÃO' : 'homologação'}. O token foi testado na Focus e guardado cifrado.`);
      console.log(resumo(depois));
      if (!depois?.municipalRegistration || !depois.taxRegime || depois.issRateBps === null) {
        console.log('Atenção: a oficina ainda precisa preencher regime, inscrição municipal e alíquota em Configurações > Nota fiscal.');
      }
    });
  } finally {
    await pool.end();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
