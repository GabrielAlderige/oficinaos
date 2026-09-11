import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isValidPlate,
  type OdometerReading,
  type Page,
  type Vehicle,
  type VehicleInput,
  type VehicleListItem,
  type VehicleUpdate,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { customerKeys, toQueryString } from '../customers/api';

export interface VehicleListParams {
  q: string;
  page: number;
  customerId?: string;
}

export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (params: VehicleListParams) => ['vehicles', 'list', params] as const,
  detail: (id: string) => ['vehicles', 'detail', id] as const,
  readings: (id: string) => ['vehicles', 'detail', id, 'readings'] as const,
  lookup: (plate: string) => ['vehicles', 'lookup', plate] as const,
};

export function useVehicles(params: VehicleListParams) {
  return useQuery({
    queryKey: vehicleKeys.list(params),
    queryFn: () =>
      api<Page<VehicleListItem>>(
        `/vehicles?${toQueryString({ q: params.q, page: params.page, customerId: params.customerId, pageSize: 25 })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useVehicle(id: string) {
  return useQuery({ queryKey: vehicleKeys.detail(id), queryFn: () => api<Vehicle>(`/vehicles/${id}`) });
}

export function useOdometerReadings(id: string) {
  return useQuery({
    queryKey: vehicleKeys.readings(id),
    queryFn: async () => (await api<{ data: OdometerReading[] }>(`/vehicles/${id}/odometer-readings`)).data,
  });
}

/** Checagem ao vivo no cadastro: a placa digitada já existe na oficina? */
export function usePlateLookup(plate: string) {
  return useQuery({
    queryKey: vehicleKeys.lookup(plate),
    queryFn: async () =>
      (await api<{ data: VehicleListItem[] }>(`/vehicles/lookup?${toQueryString({ plate })}`)).data,
    enabled: isValidPlate(plate),
  });
}

function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    void queryClient.invalidateQueries({ queryKey: customerKeys.all });
  };
}

export function useCreateVehicle() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: VehicleInput) => api<Vehicle>('/vehicles', { method: 'POST', json: body }),
    onSuccess: invalidate,
  });
}

export function useUpdateVehicle() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VehicleUpdate }) =>
      api<Vehicle>(`/vehicles/${id}`, { method: 'PATCH', json: body }),
    onSuccess: invalidate,
  });
}

export function useTransferVehicle() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, customerId }: { id: string; customerId: string }) =>
      api<Vehicle>(`/vehicles/${id}/transfer`, { method: 'POST', json: { customerId } }),
    onSuccess: invalidate,
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    // listas e clientes, mas não o detalhe do veículo apagado (ainda montado: daria 404 à toa)
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'lookup'] });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
