export const CUSTOMER_TYPES = ['PF', 'PJ'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = { PF: 'Pessoa física', PJ: 'Empresa' };

/** Como o cliente conheceu a oficina: responde "de onde vem meu cliente?" nos relatórios. */
export const CUSTOMER_SOURCES = ['INDICACAO', 'GOOGLE', 'REDES_SOCIAIS', 'PASSANTE', 'FROTA', 'OUTRO'] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];
export const CUSTOMER_SOURCE_LABELS: Record<CustomerSource, string> = {
  INDICACAO: 'Indicação',
  GOOGLE: 'Google / Maps',
  REDES_SOCIAIS: 'Redes sociais',
  PASSANTE: 'Passou na frente',
  FROTA: 'Contrato de frota',
  OUTRO: 'Outro',
};

export const FUELS = ['FLEX', 'GASOLINA', 'ETANOL', 'DIESEL', 'GNV', 'HIBRIDO', 'ELETRICO'] as const;
export type Fuel = (typeof FUELS)[number];
export const FUEL_LABELS: Record<Fuel, string> = {
  FLEX: 'Flex',
  GASOLINA: 'Gasolina',
  ETANOL: 'Etanol',
  DIESEL: 'Diesel',
  GNV: 'GNV',
  HIBRIDO: 'Híbrido',
  ELETRICO: 'Elétrico',
};

export const TRANSMISSIONS = ['MANUAL', 'AUTOMATICO', 'AUTOMATIZADO', 'CVT'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];
export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  MANUAL: 'Manual',
  AUTOMATICO: 'Automático',
  AUTOMATIZADO: 'Automatizado',
  CVT: 'CVT',
};

/** De onde veio a leitura de quilometragem. */
export const ODOMETER_SOURCES = ['MANUAL', 'CHECK_IN', 'WORK_ORDER'] as const;
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];
export const ODOMETER_SOURCE_LABELS: Record<OdometerSource, string> = {
  MANUAL: 'Atualização manual',
  CHECK_IN: 'Check-in',
  WORK_ORDER: 'Ordem de serviço',
};
