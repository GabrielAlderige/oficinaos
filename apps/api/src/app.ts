import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import type { Env } from './config/env';
import { createAuthCaches, type ServiceDeps } from './core/auth-context';
import { createAuthGuard } from './core/plugins/auth-guard';
import { registerErrorHandling } from './core/plugins/error-handler';
import { registerSecurity } from './core/plugins/security';
import type { Database } from './db/client';
import { createEmailProvider, type EmailProvider } from './integrations/email/email';
import { createStorageProvider, type StorageProvider } from './integrations/storage/storage';
import { AUTH_CACHE_TTL_MS } from './modules/auth/auth.constants';
import { authRoutes } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { AccessTokens } from './modules/auth/tokens';
import { customerRoutes } from './modules/customers/customers.routes';
import { CustomersService } from './modules/customers/customers.service';
import { inventoryRoutes, partCategoryRoutes, partRoutes } from './modules/parts/parts.routes';
import { PartsService } from './modules/parts/parts.service';
import { notificationRoutes } from './modules/notifications/notifications.routes';
import { NotificationsService } from './modules/notifications/notifications.service';
import { publicQuoteRoutes } from './modules/quotes/public-quotes.routes';
import { quoteRoutes, workOrderQuoteRoutes } from './modules/quotes/quotes.routes';
import { QuotesService } from './modules/quotes/quotes.service';
import { searchRoutes } from './modules/search/search.routes';
import { serviceRoutes } from './modules/services/services.routes';
import { ServicesService } from './modules/services/services.service';
import { vehicleRoutes } from './modules/vehicles/vehicles.routes';
import { VehiclesService } from './modules/vehicles/vehicles.service';
import { uploadRoutes, workOrderAttachmentRoutes } from './modules/uploads/uploads.routes';
import { UploadsService } from './modules/uploads/uploads.service';
import { workOrderRoutes } from './modules/work-orders/work-orders.routes';
import { WorkOrdersService } from './modules/work-orders/work-orders.service';
import { memberRoutes } from './modules/members/members.routes';
import { MembersService } from './modules/members/members.service';
import { organizationRoutes } from './modules/organizations/organizations.routes';
import { OrganizationsService } from './modules/organizations/organizations.service';
import { systemRoutes } from './modules/system/system.routes';

export interface Services {
  auth: AuthService;
  organizations: OrganizationsService;
  members: MembersService;
  customers: CustomersService;
  vehicles: VehiclesService;
  /** serviços de mão de obra do catálogo ("services" já é o nome deste objeto) */
  catalogServices: ServicesService;
  parts: PartsService;
  workOrders: WorkOrdersService;
  uploads: UploadsService;
  quotes: QuotesService;
  notifications: NotificationsService;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
    tokens: AccessTokens;
    email: EmailProvider;
    storage: StorageProvider;
    services: Services;
  }
}

export interface AppDeps {
  env: Env;
  db: Database;
  /** os testes injetam o provider em memória para ler os links enviados */
  email?: EmailProvider;
  /** os testes injetam o storage em memória: nenhum arquivo toca o disco */
  storage?: StorageProvider;
}

/** Monta a API sem abrir porta: o server.ts escuta; os testes usam `app.inject()`. */
export async function buildApp({
  env,
  db,
  email = createEmailProvider(env),
  storage = createStorageProvider(env),
}: AppDeps) {
  const app = Fastify({
    // nos testes o nível padrão é 'silent' (TEST_LOG_LEVEL=error mostra os erros)
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.refreshToken',
        ],
        censor: '[redacted]',
      },
    },
    genReqId: () => uuidv7(),
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const tokens = new AccessTokens(env.JWT_SECRET);
  const caches = createAuthCaches(AUTH_CACHE_TTL_MS);
  const deps: ServiceDeps = { db, env, email, storage, tokens, caches, log: app.log };
  const services: Services = {
    auth: new AuthService(deps),
    organizations: new OrganizationsService(deps),
    members: new MembersService(deps),
    customers: new CustomersService(deps),
    vehicles: new VehiclesService(deps),
    catalogServices: new ServicesService(deps),
    parts: new PartsService(deps),
    workOrders: new WorkOrdersService(deps),
    uploads: new UploadsService(deps),
    quotes: new QuotesService(deps),
    notifications: new NotificationsService(deps),
  };

  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('tokens', tokens);
  app.decorate('email', email);
  app.decorate('storage', storage);
  app.decorate('services', services);
  app.decorateRequest('auth', null);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
  await registerSecurity(app, env);
  await app.register(cookie);

  // toda rota exige login, salvo as que declaram config.auth = 'public'.
  // preValidation: autoriza ANTES de validar o corpo (sem permissão = 403, sem revelar o formato esperado)
  app.addHook('preValidation', createAuthGuard({ db, tokens, caches, auth: services.auth }));

  await app.register(systemRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(organizationRoutes, { prefix: '/api/v1/organization' });
  await app.register(memberRoutes, { prefix: '/api/v1/members' });
  await app.register(customerRoutes, { prefix: '/api/v1/customers' });
  await app.register(vehicleRoutes, { prefix: '/api/v1/vehicles' });
  await app.register(searchRoutes, { prefix: '/api/v1/search' });
  await app.register(serviceRoutes, { prefix: '/api/v1/services' });
  await app.register(partCategoryRoutes, { prefix: '/api/v1/part-categories' });
  await app.register(partRoutes, { prefix: '/api/v1/parts' });
  await app.register(inventoryRoutes, { prefix: '/api/v1/inventory' });
  await app.register(workOrderRoutes, { prefix: '/api/v1/work-orders' });
  await app.register(workOrderAttachmentRoutes, { prefix: '/api/v1/work-orders' });
  await app.register(uploadRoutes, { prefix: '/api/v1/uploads' });
  await app.register(workOrderQuoteRoutes, { prefix: '/api/v1/work-orders' });
  await app.register(quoteRoutes, { prefix: '/api/v1/quotes' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  // sem login: o token do link é a credencial (limite por IP em cada rota)
  await app.register(publicQuoteRoutes, { prefix: '/api/v1/public' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
