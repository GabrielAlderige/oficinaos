import { z } from 'zod';
import { isValidPlate } from '../br/plate';
import { FUELS, ODOMETER_SOURCES, TRANSMISSIONS } from '../enums/vehicles';
import { optionalText } from './common';

const MIN_YEAR = 1950;
const maxYear = () => new Date().getFullYear() + 1;

// ---- API (números como número, vazio como null) ----

const year = z.number().int().min(MIN_YEAR, 'Ano inválido').max(2100, 'Ano inválido').nullable();

const vehicleFields = {
  customerId: z.uuid('Escolha o cliente'),
  /** vazio = carro sem placa (zero km, recém-importado) */
  plate: z.string().trim().refine((v) => v === '' || isValidPlate(v), 'Placa inválida. Use ABC-1234 ou ABC1D23'),
  make: z.string().trim().min(1, 'Informe a marca').max(60),
  model: z.string().trim().min(1, 'Informe o modelo').max(80),
  version: optionalText(80),
  engine: optionalText(40),
  color: optionalText(30),
  yearManufacture: year,
  yearModel: year,
  fuel: z.enum(FUELS).nullable(),
  transmission: z.enum(TRANSMISSIONS).nullable(),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-HJ-NPR-Z0-9]{17}$/.test(v), 'O chassi tem 17 caracteres, sem I, O e Q'),
  odometerKm: z.number().int().min(0, 'Quilometragem inválida').max(9_999_999, 'Quilometragem inválida').nullable(),
  notes: optionalText(2000),
};

/** Ano/modelo é o ano de fabricação ou o seguinte (carro 2023/2024). */
function yearsAreCoherent(value: { yearManufacture?: number | null; yearModel?: number | null }, ctx: z.RefinementCtx) {
  const { yearManufacture: made, yearModel: model } = value;
  if (made && model && (model < made || model > made + 1)) {
    ctx.addIssue({ code: 'custom', path: ['yearModel'], message: 'O ano/modelo é o de fabricação ou o seguinte' });
  }
}

/** Criação: obrigatórios só cliente, marca e modelo; o resto tem padrão. */
export const createVehicleSchema = z
  .object({
    ...vehicleFields,
    plate: vehicleFields.plate.default(''),
    version: vehicleFields.version.default(''),
    engine: vehicleFields.engine.default(''),
    color: vehicleFields.color.default(''),
    yearManufacture: vehicleFields.yearManufacture.default(null),
    yearModel: vehicleFields.yearModel.default(null),
    fuel: vehicleFields.fuel.default(null),
    transmission: vehicleFields.transmission.default(null),
    vin: vehicleFields.vin.default(''),
    odometerKm: vehicleFields.odometerKm.default(null),
    notes: vehicleFields.notes.default(''),
  })
  .superRefine(yearsAreCoherent);

/** Edição: SEM padrões. O dono muda por /transfer (fica registrado), não por aqui. */
export const updateVehicleSchema = z
  .object(vehicleFields)
  .omit({ customerId: true })
  .extend({
    /** a quilometragem nova é menor que a última: só grava com confirmação explícita */
    confirmOdometerDecrease: z.boolean(),
  })
  .partial()
  .superRefine(yearsAreCoherent);

export const transferVehicleSchema = z.object({ customerId: z.uuid('Escolha o novo dono') });

// ---- formulário (texto → número/null; a saída tem o formato da API) ----

const yearText = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d{4}$/.test(v) && +v >= MIN_YEAR && +v <= maxYear()), 'Ano inválido')
  .transform((v) => (v === '' ? null : Number(v)));

const kmText = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{1,3}(\.?\d{3}){0,2}$/.test(v), 'Quilometragem inválida')
  .transform((v) => (v === '' ? null : Number(v.replace(/\./g, ''))));

const optionalFuel = z
  .enum(FUELS)
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v));
const optionalTransmission = z
  .enum(TRANSMISSIONS)
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v));

export const vehicleFormSchema = z
  .object({
    ...vehicleFields,
    yearManufacture: yearText,
    yearModel: yearText,
    odometerKm: kmText,
    fuel: optionalFuel,
    transmission: optionalTransmission,
  })
  .superRefine(yearsAreCoherent);

// ---- saída ----

export const vehicleOwnerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  whatsapp: z.string().nullable(),
});

export const vehicleSchema = z.object({
  id: z.uuid(),
  customer: vehicleOwnerSchema,
  plate: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  version: z.string().nullable(),
  engine: z.string().nullable(),
  color: z.string().nullable(),
  yearManufacture: z.number().int().nullable(),
  yearModel: z.number().int().nullable(),
  fuel: z.enum(FUELS).nullable(),
  transmission: z.enum(TRANSMISSIONS).nullable(),
  vin: z.string().nullable(),
  odometerKm: z.number().int().nullable(),
  odometerUpdatedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const vehicleListItemSchema = z.object({
  id: z.uuid(),
  plate: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  version: z.string().nullable(),
  yearManufacture: z.number().int().nullable(),
  yearModel: z.number().int().nullable(),
  odometerKm: z.number().int().nullable(),
  customer: z.object({ id: z.uuid(), name: z.string() }),
});

export const odometerReadingSchema = z.object({
  id: z.uuid(),
  km: z.number().int(),
  source: z.enum(ODOMETER_SOURCES),
  recordedByName: z.string().nullable(),
  recordedAt: z.string(),
});

export const vehicleListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  customerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const plateLookupQuerySchema = z.object({ plate: z.string().trim().min(2).max(10) });

export type VehicleForm = z.input<typeof vehicleFormSchema>;
export type VehicleInput = z.output<typeof createVehicleSchema>;
export type VehicleUpdate = z.output<typeof updateVehicleSchema>;
export type Vehicle = z.infer<typeof vehicleSchema>;
export type VehicleListItem = z.infer<typeof vehicleListItemSchema>;
export type OdometerReading = z.infer<typeof odometerReadingSchema>;
