import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** E-mail sem diferenciar maiúsculas (extensão citext). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** UUID v7 gerado na aplicação: ordenável por tempo, não expõe volume (DATABASE.md §1). */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

export const timestamps = {
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().$onUpdate(() => new Date()),
};
