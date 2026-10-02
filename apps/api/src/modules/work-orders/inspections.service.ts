import {
  type AttachmentStatus,
  type CreateInspectionInput,
  type Inspection,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { assertOdometerNotDecreasing } from '../../core/odometer';
import { withTenant } from '../../db/tenant';
import { applyWorkOrderChange } from './totals';
import { findWorkOrderOrThrow, lockEditableWorkOrder } from './work-orders.guards';
import * as repo from './work-orders.repository';

/**
 * Check-in e check-out da OS (E5): o estado do carro quando entrou e quando
 * saiu, com fotos e a assinatura do cliente na entrega (E28).
 *
 * Saiu do service da OS, que passava de 1.400 linhas; usa as mesmas travas
 * (`./work-orders.guards`) e o mesmo recálculo (`./totals`).
 */
export class InspectionsService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, id: string): Promise<Inspection[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await findWorkOrderOrThrow(tx, auth.organizationId, id);
      const rows = await repo.listInspections(tx, auth.organizationId, id);
      if (!rows.length) return [];

      // a assinatura e as fotos da entrega (E28) vêm em UMA consulta para as
      // inspeções todas: uma por inspeção transformaria o check-in do dia em
      // uma dúzia de idas ao banco
      const anexos = await repo.listInspectionAttachments(
        tx,
        auth.organizationId,
        rows.map(({ inspection }) => inspection.id),
      );

      return rows.map(({ inspection, performedByName }) => {
        const meus = anexos.filter((anexo) => anexo.inspectionId === inspection.id);
        const assinatura = meus.find((anexo) => anexo.id === inspection.signatureAttachmentId) ?? null;
        return {
          id: inspection.id,
          type: inspection.type,
          odometerKm: inspection.odometerKm,
          fuelLevel: inspection.fuelLevel,
          checklist: inspection.checklist.map((entry) => ({ ...entry, note: entry.note ?? '' })),
          damages: inspection.damages.map((damage) => ({
            ...damage,
            note: damage.note ?? '',
            attachmentId: damage.attachmentId ?? null,
          })),
          accessories: inspection.accessories,
          notes: inspection.notes ?? '',
          performedByName,
          performedAt: inspection.performedAt.toISOString(),
          customerAcknowledgedAt: isoOrNull(inspection.customerAcknowledgedAt),
          signerName: inspection.signerName,
          signature: assinatura ? this.anexoDto(assinatura) : null,
          photos: meus.filter((anexo) => anexo.id !== inspection.signatureAttachmentId).map((a) => this.anexoDto(a)),
        };
      });
    });
  }

  /** O anexo como a tela precisa: com a URL assinada, que é a credencial (E5). */
  private anexoDto(row: {
    id: string;
    kind: 'PHOTO' | 'VIDEO' | 'DOCUMENT';
    fileName: string | null;
    mimeType: string;
    sizeBytes: number;
    caption: string | null;
    visibleToCustomer: boolean;
    status: AttachmentStatus;
    storageKey: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      caption: row.caption,
      visibleToCustomer: row.visibleToCustomer,
      status: row.status,
      url: this.deps.storage.signDownload(row.storageKey).url,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Check-in e check-out: o que o carro era quando entrou, para não sobrar discussão. */
  async create(
    auth: AuthContext,
    id: string,
    input: CreateInspectionInput,
    client: ClientInfo,
  ): Promise<Inspection> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await lockEditableWorkOrder(tx, auth.organizationId, id);

      // o km do check-in é o km do carro: vale a mesma regra do cadastro (E3)
      if (input.odometerKm !== null) {
        const vehicle = await repo.lockVehicleOdometer(tx, auth.organizationId, order.vehicleId);
        assertOdometerNotDecreasing({
          previousKm: vehicle?.odometerKm ?? null,
          nextKm: input.odometerKm,
          confirmed: input.confirmOdometerDecrease,
          field: 'body.odometerKm',
        });
      }

      const row = await repo.insertInspection(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        vehicleId: order.vehicleId,
        type: input.type,
        odometerKm: input.odometerKm,
        fuelLevel: input.fuelLevel,
        checklist: input.checklist,
        damages: input.damages,
        accessories: input.accessories,
        notes: blankToNull(input.notes),
        performedBy: auth.userId,
      });
      if (input.odometerKm !== null) {
        await applyWorkOrderChange(tx, order, { odometerKm: input.odometerKm });
        await repo.updateVehicleOdometer(tx, order.vehicleId, input.odometerKm);
        await repo.insertOdometerReading(tx, {
          organizationId: auth.organizationId,
          vehicleId: order.vehicleId,
          km: input.odometerKm,
          source: input.type === 'CHECK_IN' ? 'CHECK_IN' : 'WORK_ORDER',
          workOrderId: id,
          recordedBy: auth.userId,
        });
      }

      await repo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: id,
        type: input.type,
        data: {
          odometerKm: input.odometerKm,
          issues: input.checklist.filter((entry) => entry.state === 'ISSUE').length,
          damages: input.damages.length,
        },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: `work_order.${input.type.toLowerCase()}`,
        entityType: 'work_order',
        entityId: id,
        metadata: { number: order.number, odometerKm: input.odometerKm },
        ...client,
      });

      return {
        id: row.id,
        type: row.type,
        odometerKm: row.odometerKm,
        fuelLevel: row.fuelLevel,
        checklist: input.checklist,
        damages: input.damages,
        accessories: input.accessories,
        notes: row.notes ?? '',
        performedByName: null,
        performedAt: row.performedAt.toISOString(),
        customerAcknowledgedAt: isoOrNull(row.customerAcknowledgedAt),
        signerName: row.signerName,
        signature: null,
        photos: [],
      };
    });
  }
}
