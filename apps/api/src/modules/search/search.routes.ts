import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { can, searchQuerySchema, searchResultSchema } from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

const LIMIT = 5;

/** Busca global (⌘K): placa (começo ou final), nome, telefone, documento ou número da OS. */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  const { customers, vehicles, workOrders } = app.services;

  app.get(
    '/',
    {
      config: { auth: 'customers:read' },
      schema: { querystring: searchQuerySchema, response: { 200: searchResultSchema } },
    },
    async (request) => {
      const auth = getAuth(request);
      /**
       * Primeiro as OS que ainda estão na oficina, depois as mais recentes, e as
       * canceladas no fim.
       * No balcão, quem digita a placa quer o carro que está ali agora — com
       * só a ordem de abertura, uma OS cancelada ontem passava na frente e o
       * Enter abria ela.
       */
      const ordensDoBalcao = async (busca: string) => {
        const naOficina = await workOrders.list(auth, { q: busca, status: 'active', page: 1, pageSize: LIMIT });
        if (naOficina.data.length >= LIMIT) return naOficina;
        const todas = await workOrders.list(auth, { q: busca, status: 'all', page: 1, pageSize: LIMIT });
        const vistas = new Set(naOficina.data.map((os) => os.id));
        // das que já saíram, a cancelada vai por último: quase nunca é ela que se procura
        const resto = todas.data
          .filter((os) => !vistas.has(os.id))
          .sort((a, b) => Number(a.status === 'CANCELED') - Number(b.status === 'CANCELED'));
        return { ...todas, data: [...naOficina.data, ...resto].slice(0, LIMIT) };
      };
      const q = request.query.q;
      const [foundCustomers, foundVehicles, foundOrders] = await Promise.all([
        customers.search(auth, q, LIMIT),
        vehicles.search(auth, q, LIMIT),
        // quem não pode ver OS (papel sem work_orders:read) não recebe OS na busca
        can(auth.role, 'work_orders:read') ? ordensDoBalcao(q) : null,
      ]);
      return {
        customers: foundCustomers,
        vehicles: foundVehicles,
        workOrders: (foundOrders?.data ?? []).map((os) => ({
          id: os.id,
          number: os.number,
          status: os.status,
          customerName: os.customerName,
          vehiclePlate: os.vehiclePlate,
          vehicleName: os.vehicleName,
          openedAt: os.openedAt,
        })),
      };
    },
  );
};
