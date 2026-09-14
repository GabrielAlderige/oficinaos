/**
 * Garantias que o BANCO dá sozinho na cotação com fornecedores (E11). Se um dia
 * a aplicação errar — gravar a placa, forjar preço, editar uma resposta —, é
 * aqui que o erro para. Por isso cada trava tem teste próprio, sem API no meio.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  organizations,
  users,
  supplierQuoteAwards,
  supplierQuoteInvites,
  supplierQuoteRequestItems,
  supplierQuoteRequests,
  supplierQuoteResponseItems,
  supplierQuoteResponses,
  suppliers,
} from '../src/db/schema';
import { withoutTenant, withSupplierToken, withTenant } from '../src/db/tenant';
import { testDb } from './helpers';

const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');
const HASH = 'a'.repeat(64);
const emDoisDias = () => new Date(Date.now() + 48 * 3_600_000);

/** O Postgres embrulhado pelo Drizzle: o nome da constraint violada vem no `cause`. */
async function violacao(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (err) {
    const e = err as { cause?: { constraint?: string; code?: string; message?: string } };
    return e.cause?.constraint ?? e.cause?.code ?? e.cause?.message ?? String(err);
  }
  return 'NÃO RECUSOU';
}

describe('cotação com fornecedores no banco', () => {
  const { db } = testDb();
  const org = uuidv7();
  const outraOrg = uuidv7();
  const fornecedorA = uuidv7();
  const fornecedorB = uuidv7();
  const request = uuidv7();
  const requestItem = uuidv7();
  const inviteA = uuidv7();
  const inviteB = uuidv7();
  const tokenA = randomBytes(32).toString('base64url');
  const tokenB = randomBytes(32).toString('base64url');
  const gerente = uuidv7();

  const naOficina = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, { organizationId: org }, fn);

  beforeAll(async () => {
    // quem escolhe a oferta precisa existir: `users` é global, sem contexto de oficina
    await withoutTenant(db, (tx) =>
      tx.insert(users).values({ id: gerente, name: 'Gerente', email: `gerente-${gerente}@teste.local`, passwordHash: 'x' }),
    );
    await withTenant(db, { organizationId: outraOrg }, (tx) => tx.insert(organizations).values({ id: outraOrg, name: 'Outra' }));
    await naOficina(async (tx) => {
      await tx.insert(organizations).values({ id: org, name: 'Oficina' });
      await tx.insert(suppliers).values([
        { id: fornecedorA, organizationId: org, name: 'Fornecedor A' },
        { id: fornecedorB, organizationId: org, name: 'Fornecedor B' },
      ]);
      await tx.insert(supplierQuoteRequests).values({
        id: request,
        organizationId: org,
        number: 1,
        contentHash: HASH,
        expiresAt: emDoisDias(),
        vehicle: { make: 'VW', model: 'Gol', version: null, year: 2019, engine: null, vin: null },
      });
      await tx.insert(supplierQuoteRequestItems).values({
        id: requestItem,
        organizationId: org,
        requestId: request,
        description: 'Pastilha',
        quantity: '1',
      });
      await tx.insert(supplierQuoteInvites).values([
        { id: inviteA, organizationId: org, requestId: request, supplierId: fornecedorA, tokenHash: sha256(tokenA) },
        { id: inviteB, organizationId: org, requestId: request, supplierId: fornecedorB, tokenHash: sha256(tokenB) },
      ]);
    });
  });

  // ------------------------------ o carro ------------------------------------

  it('recusa gravar a placa no veículo da cotação, venha de onde vier', async () => {
    const erro = await violacao(
      naOficina((tx) =>
        tx.insert(supplierQuoteRequests).values({
          organizationId: org,
          number: 2,
          contentHash: HASH,
          expiresAt: emDoisDias(),
          vehicle: { make: 'VW', model: 'Gol', plate: 'ABC1D23' } as never,
        }),
      ),
    );
    expect(erro).toBe('supplier_quote_requests_no_plate_check');
  });

  it('recusa chassi quando a oficina não marcou "incluir chassi"', async () => {
    const erro = await violacao(
      naOficina((tx) =>
        tx.insert(supplierQuoteRequests).values({
          organizationId: org,
          number: 3,
          contentHash: HASH,
          expiresAt: emDoisDias(),
          includeVin: false,
          vehicle: { make: 'VW', model: 'Gol', version: null, year: null, engine: null, vin: '9BWAB45U0KT000001' },
        }),
      ),
    );
    expect(erro).toBe('supplier_quote_requests_vin_check');

    // com a marcação, o mesmo chassi passa
    await naOficina((tx) =>
      tx.insert(supplierQuoteRequests).values({
        organizationId: org,
        number: 4,
        contentHash: HASH,
        expiresAt: emDoisDias(),
        includeVin: true,
        vehicle: { make: 'VW', model: 'Gol', version: null, year: null, engine: null, vin: '9BWAB45U0KT000001' },
      }),
    );
  });

  // ------------------------------ o link -------------------------------------

  it('o hash do link lê exatamente o convite daquele fornecedor, e nada mais', async () => {
    const vistos = await withSupplierToken(db, sha256(tokenA), (tx) =>
      tx.select({ id: supplierQuoteInvites.id }).from(supplierQuoteInvites),
    );
    expect(vistos.map((v) => v.id)).toEqual([inviteA]);

    // nem a cotação, nem os itens, nem o convite do outro fornecedor
    const cotacoes = await withSupplierToken(db, sha256(tokenA), (tx) => tx.select().from(supplierQuoteRequests));
    const itens = await withSupplierToken(db, sha256(tokenA), (tx) => tx.select().from(supplierQuoteRequestItems));
    expect(cotacoes).toEqual([]);
    expect(itens).toEqual([]);
  });

  it('o token em texto aberto não abre nada: o banco só conhece o hash', async () => {
    // quem copiasse a coluna do banco teria o hash, e o hash não é o link
    const comHashDoHash = await withSupplierToken(db, sha256(sha256(tokenA)), (tx) =>
      tx.select().from(supplierQuoteInvites),
    );
    expect(comHashDoHash).toEqual([]);
    expect(() => withSupplierToken(db, tokenA, async () => null)).toThrow(/hash sha256/);
  });

  it('a oficina de fora não vê convite nenhum', async () => {
    const vistos = await withTenant(db, { organizationId: outraOrg }, (tx) => tx.select().from(supplierQuoteInvites));
    expect(vistos).toEqual([]);
  });

  // ---------------------------- a resposta -----------------------------------

  it('"não tenho" com preço e "tenho" sem preço são recusados pelo banco', async () => {
    const resposta = uuidv7();
    await naOficina((tx) =>
      tx.insert(supplierQuoteResponses).values({
        id: resposta,
        organizationId: org,
        inviteId: inviteA,
        version: 1,
        responderName: 'Roberto',
        contentHash: HASH,
      }),
    );
    const fantasma = await violacao(
      naOficina((tx) =>
        tx.insert(supplierQuoteResponseItems).values({
          organizationId: org,
          responseId: resposta,
          requestItemId: requestItem,
          availability: 'UNAVAILABLE',
          unitPriceCents: 100,
        }),
      ),
    );
    expect(fantasma).toBe('supplier_quote_response_items_price_check');

    const semPreco = await violacao(
      naOficina((tx) =>
        tx.insert(supplierQuoteResponseItems).values({
          organizationId: org,
          responseId: resposta,
          requestItemId: requestItem,
          availability: 'AVAILABLE',
          unitPriceCents: null,
        }),
      ),
    );
    expect(semPreco).toBe('supplier_quote_response_items_price_check');
  });

  it('duas versões com o mesmo número não existem: é o índice que impede', async () => {
    const erro = await violacao(
      naOficina((tx) =>
        tx.insert(supplierQuoteResponses).values({
          organizationId: org,
          inviteId: inviteA,
          version: 1,
          responderName: 'Roberto de novo',
          contentHash: HASH,
        }),
      ),
    );
    expect(erro).toBe('supplier_quote_responses_invite_version_unique');
  });

  it('resposta e histórico de preço são append-only para a aplicação', async () => {
    const { rows } = await db.execute<{ tabela: string; update: boolean; delete: boolean; insert: boolean }>(sql`
      select t.tabela,
             has_table_privilege(current_user, t.tabela, 'UPDATE') as update,
             has_table_privilege(current_user, t.tabela, 'DELETE') as delete,
             has_table_privilege(current_user, t.tabela, 'INSERT') as insert
      from (values ('supplier_quote_responses'), ('supplier_quote_response_items'), ('part_price_history')) as t(tabela)
    `);
    expect(rows).toEqual([
      { tabela: 'supplier_quote_responses', update: false, delete: false, insert: true },
      { tabela: 'supplier_quote_response_items', update: false, delete: false, insert: true },
      { tabela: 'part_price_history', update: false, delete: false, insert: true },
    ]);
  });

  it('uma escolha por peça: a segunda é recusada pelo banco', async () => {
    const resposta = await naOficina(async (tx) => {
      const [versao] = await tx
        .select({ id: supplierQuoteResponses.id })
        .from(supplierQuoteResponses)
        .where(eq(supplierQuoteResponses.inviteId, inviteA));
      const [linha] = await tx
        .insert(supplierQuoteResponseItems)
        .values({
          organizationId: org,
          responseId: versao!.id,
          requestItemId: requestItem,
          availability: 'AVAILABLE',
          unitPriceCents: 9900,
        })
        .returning();
      return linha!;
    });
    const awardedBy = gerente;
    await naOficina((tx) =>
      tx.insert(supplierQuoteAwards).values({ organizationId: org, requestItemId: requestItem, responseItemId: resposta.id, awardedBy }),
    );
    const segunda = await violacao(
      naOficina((tx) =>
        tx.insert(supplierQuoteAwards).values({ organizationId: org, requestItemId: requestItem, responseItemId: resposta.id, awardedBy }),
      ),
    );
    expect(segunda).toBe('supplier_quote_awards_request_item_unique');
  });
});
