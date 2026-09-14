import { describe, expect, it } from 'vitest';
import {
  canonicalSupplierQuotePayload,
  compareOffers,
  isSupplierQuoteAnswerable,
  isSupplierQuoteExpired,
  latestVersions,
  summarizeSuppliers,
  vehicleForSupplier,
  type OfferLine,
  type SupplierResponseVersion,
  type VehicleForQuote,
} from './supplier-quotes';

const carro: VehicleForQuote = {
  make: 'Volkswagen',
  model: 'Gol',
  version: '1.6 MSI',
  yearModel: 2019,
  yearManufacture: 2018,
  engine: 'EA211',
  vin: '9BWAB45U0KT000001',
  plate: 'ABC1D23',
};

describe('o carro que vai para o fornecedor', () => {
  it('a placa nunca sai da oficina, nem pedindo o chassi', () => {
    const semChassi = vehicleForSupplier(carro, false);
    const comChassi = vehicleForSupplier(carro, true);
    expect(JSON.stringify(semChassi)).not.toContain('ABC1D23');
    expect(JSON.stringify(comChassi)).not.toContain('ABC1D23');
    expect(Object.keys(comChassi)).not.toContain('plate');
  });

  it('o chassi só vai quando a oficina marca', () => {
    expect(vehicleForSupplier(carro, false).vin).toBeNull();
    expect(vehicleForSupplier(carro, true).vin).toBe('9BWAB45U0KT000001');
  });

  it('um campo novo no carro não vaza sozinho: a saída é montada campo a campo', () => {
    const comDono = { ...carro, ownerName: 'João Pereira', renavam: '12345678901' } as VehicleForQuote;
    const saida = JSON.stringify(vehicleForSupplier(comDono, true));
    expect(saida).not.toContain('João Pereira');
    expect(saida).not.toContain('12345678901');
  });

  it('vai o ano do modelo, e o de fabricação só na falta dele', () => {
    expect(vehicleForSupplier(carro, false).year).toBe(2019);
    expect(vehicleForSupplier({ ...carro, yearModel: null }, false).year).toBe(2018);
  });
});

describe('o conteúdo congelado da cotação', () => {
  const base = {
    items: [
      { id: 'b', description: 'Disco de freio', partCode: 'DF-1', brand: null, quantityMilli: 2000, unit: 'UN' },
      { id: 'a', description: 'Pastilha', partCode: 'PS-9', brand: 'Cobreq', quantityMilli: 1000, unit: 'JG' },
    ],
    vehicle: vehicleForSupplier(carro, false),
    message: 'Preciso para amanhã',
    expiresAt: '2026-09-16T12:00:00.000Z',
  };

  it('o mesmo conteúdo dá o mesmo texto, em qualquer ordem de item', () => {
    const invertido = { ...base, items: [...base.items].reverse() };
    expect(canonicalSupplierQuotePayload(invertido)).toBe(canonicalSupplierQuotePayload(base));
  });

  it('mudar quantidade, código ou chassi muda o texto', () => {
    const original = canonicalSupplierQuotePayload(base);
    const outraQuantidade = { ...base, items: [{ ...base.items[0]!, quantityMilli: 3000 }, base.items[1]!] };
    const outroCodigo = { ...base, items: [base.items[0]!, { ...base.items[1]!, partCode: 'PS-10' }] };
    const comChassi = { ...base, vehicle: vehicleForSupplier(carro, true) };
    expect(canonicalSupplierQuotePayload(outraQuantidade)).not.toBe(original);
    expect(canonicalSupplierQuotePayload(outroCodigo)).not.toBe(original);
    expect(canonicalSupplierQuotePayload(comChassi)).not.toBe(original);
  });
});

describe('validade', () => {
  const agora = new Date('2026-09-14T12:00:00Z');
  const daqui = (horas: number) => new Date(agora.getTime() + horas * 3_600_000);

  it('aberta e dentro do prazo aceita resposta', () => {
    expect(isSupplierQuoteAnswerable({ status: 'OPEN', expiresAt: daqui(1) }, agora)).toBe(true);
  });

  it('no instante exato do prazo já não aceita', () => {
    expect(isSupplierQuoteAnswerable({ status: 'OPEN', expiresAt: agora }, agora)).toBe(false);
    expect(isSupplierQuoteExpired({ status: 'OPEN', expiresAt: agora }, agora)).toBe(true);
  });

  it('encerrada ou cancelada não aceita, mesmo dentro do prazo, e não conta como vencida', () => {
    expect(isSupplierQuoteAnswerable({ status: 'CLOSED', expiresAt: daqui(10) }, agora)).toBe(false);
    expect(isSupplierQuoteAnswerable({ status: 'CANCELED', expiresAt: daqui(10) }, agora)).toBe(false);
    expect(isSupplierQuoteExpired({ status: 'CLOSED', expiresAt: daqui(-10) }, agora)).toBe(false);
  });
});

const oferta = (over: Partial<OfferLine> & Pick<OfferLine, 'responseItemId' | 'supplierId'>): OfferLine => ({
  requestItemId: 'pastilha',
  availability: 'AVAILABLE',
  unitPriceCents: 10000,
  leadTimeDays: 1,
  ...over,
});

describe('a comparação de ofertas', () => {
  it('vale a última versão de cada fornecedor; as anteriores ficam de fora da conta', () => {
    const respostas = [
      { inviteId: 'A', version: 1, preco: 200 },
      { inviteId: 'A', version: 2, preco: 150 },
      { inviteId: 'B', version: 1, preco: 180 },
    ];
    const ultimas = latestVersions(respostas);
    expect(ultimas).toHaveLength(2);
    expect(ultimas.find((r) => r.inviteId === 'A')?.preco).toBe(150);
  });

  it('o mais barato e o mais rápido por item, que podem ser fornecedores diferentes', () => {
    const latest: SupplierResponseVersion[] = [
      {
        inviteId: 'iA', supplierId: 'A', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'a1', supplierId: 'A', unitPriceCents: 9000, leadTimeDays: 5 })],
      },
      {
        inviteId: 'iB', supplierId: 'B', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'b1', supplierId: 'B', unitPriceCents: 12000, leadTimeDays: 0 })],
      },
    ];
    const [pastilha] = compareOffers(['pastilha'], latest);
    expect(pastilha!.cheapest?.supplierId).toBe('A');
    expect(pastilha!.fastest?.supplierId).toBe('B');
    expect(pastilha!.offers.map((o) => o.supplierId)).toEqual(['A', 'B']);
  });

  it('"não tenho" e oferta sem preço nunca ganham, nem de graça', () => {
    const latest: SupplierResponseVersion[] = [
      {
        inviteId: 'iA', supplierId: 'A', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'a1', supplierId: 'A', availability: 'UNAVAILABLE', unitPriceCents: 0 })],
      },
      {
        inviteId: 'iB', supplierId: 'B', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'b1', supplierId: 'B', unitPriceCents: null })],
      },
    ];
    const [pastilha] = compareOffers(['pastilha'], latest);
    expect(pastilha!.offers).toEqual([]);
    expect(pastilha!.cheapest).toBeNull();
    expect(pastilha!.fastest).toBeNull();
  });

  it('empate de preço vai para quem entrega antes', () => {
    const latest: SupplierResponseVersion[] = [
      {
        inviteId: 'iA', supplierId: 'A', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'a1', supplierId: 'A', unitPriceCents: 10000, leadTimeDays: 4 })],
      },
      {
        inviteId: 'iB', supplierId: 'B', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'b1', supplierId: 'B', unitPriceCents: 10000, leadTimeDays: 1 })],
      },
    ];
    expect(compareOffers(['pastilha'], latest)[0]!.cheapest?.supplierId).toBe('B');
  });

  it('prazo não informado não ganha "mais rápido"', () => {
    const latest: SupplierResponseVersion[] = [
      {
        inviteId: 'iA', supplierId: 'A', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'a1', supplierId: 'A', leadTimeDays: null })],
      },
    ];
    expect(compareOffers(['pastilha'], latest)[0]!.fastest).toBeNull();
  });
});

describe('o resumo por fornecedor', () => {
  it('soma preço × quantidade só do que ele tem, e o frete entra no total', () => {
    const latest: SupplierResponseVersion[] = [
      {
        inviteId: 'iA', supplierId: 'A', version: 1, shippingCents: 2500,
        items: [
          oferta({ responseItemId: 'a1', supplierId: 'A', requestItemId: 'pastilha', unitPriceCents: 10000 }),
          oferta({ responseItemId: 'a2', supplierId: 'A', requestItemId: 'disco', unitPriceCents: 15050 }),
          oferta({ responseItemId: 'a3', supplierId: 'A', requestItemId: 'fluido', availability: 'UNAVAILABLE' }),
        ],
      },
    ];
    const quantidades = new Map([
      ['pastilha', 1000],
      ['disco', 2000],
      ['fluido', 500],
    ]);
    const [resumo] = summarizeSuppliers(latest, quantidades);
    expect(resumo).toEqual({
      supplierId: 'A',
      coveredItems: 2,
      itemsTotalCents: 10000 + 30100,
      shippingCents: 2500,
      totalCents: 10000 + 30100 + 2500,
    });
  });

  it('quantidade fracionada arredonda no fim da linha', () => {
    const latest: SupplierResponseVersion[] = [
      {
        inviteId: 'iA', supplierId: 'A', version: 1, shippingCents: null,
        items: [oferta({ responseItemId: 'a1', supplierId: 'A', requestItemId: 'oleo', unitPriceCents: 3333 })],
      },
    ];
    // 3,5 litros a R$ 33,33 = R$ 116,655 → R$ 116,66
    expect(summarizeSuppliers(latest, new Map([['oleo', 3500]]))[0]!.itemsTotalCents).toBe(11666);
  });
});
