import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { devices } from '../../device/models/device.model';
import { verificationOrganizations } from '../../catalog/models/verificationOrganization.model';

// 1. ЗАГОЛОВОК ПРЕЙСКУРАНТА ЦСМ
export const pricelists = pgTable('pricelists', {
  id: uuid('id').primaryKey().defaultRandom(),
  verificationOrganizationId: uuid('verification_organization_id')
    .notNull()
    .references(() => verificationOrganizations.id),
  title: varchar('title', { length: 255 }).notNull(),
  year: integer('year').notNull(),
  isRegulated: boolean('is_regulated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 2. СТРОКИ ПРЕЙСКУРАНТА
export const pricelistItems = pgTable(
  'pricelist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pricelistId: uuid('pricelist_id')
      .notNull()
      .references(() => pricelists.id, { onDelete: 'cascade' }),
    grsiNumber: text('grsi_number'),
    csmCode: text('csm_code'),
    // modelOrType: text('model_or_type'),
    // name: text('name').notNull(),

    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    // 🎯 ДОБАВЛЕНО: Год действия конкретного тарифа (2025, 2026, 2027)
    year: integer('year').notNull().default(2026),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    grsiIdx: index('pi_grsi_idx').on(table.grsiNumber),
    csmCodeIdx: index('pi_csm_code_idx').on(table.csmCode),
    pricelistIdx: index('pi_pricelist_idx').on(table.pricelistId),
  })
);

// 3. ПЛАН БЮДЖЕТА НА ГОД (Заголовок)
export const budgetPlans = pgTable('budget_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  status: text('status').notNull().default('draft'), // 'draft' | 'approved'
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 4. СТРОКИ БЮДЖЕТА (СНИМОК ЦЕН)
export const budgetPlanItems = pgTable('budget_plan_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  budgetPlanId: uuid('budget_plan_id')
    .notNull()
    .references(() => budgetPlans.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  deviceName: varchar('device_name').notNull(),
  deviceModel: varchar('device_model').notNull(),
  matchedPricelistItemId: uuid('matched_pricelist_item_id').references(
    () => pricelistItems.id
  ),
  matchMethod: text('match_method').notNull(),
  basePrice: numeric('base_price', { precision: 10, scale: 2 }).notNull(),
  vatAmount: numeric('vat_amount', { precision: 10, scale: 2 })
    .notNull()
    .default('0.00'),
  totalCost: numeric('total_cost', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- РЕЙЛЕЙШЕНЫ (RELATIONS) ДЛЯ СИНТАКСИСА DB.QUERY ---

export const pricelistsRelations = relations(pricelists, ({ one, many }) => ({
  items: many(pricelistItems),
  verificationOrganization: one(verificationOrganizations, {
    fields: [pricelists.verificationOrganizationId],
    references: [verificationOrganizations.id],
  }),
}));

export const pricelistItemsRelations = relations(pricelistItems, ({ one }) => ({
  pricelist: one(pricelists, {
    fields: [pricelistItems.pricelistId],
    references: [pricelists.id],
  }),
}));

export const budgetPlansRelations = relations(budgetPlans, ({ many }) => ({
  items: many(budgetPlanItems),
}));

export const budgetPlanItemsRelations = relations(
  budgetPlanItems,
  ({ one }) => ({
    budgetPlan: one(budgetPlans, {
      fields: [budgetPlanItems.budgetPlanId],
      references: [budgetPlans.id],
    }),
    device: one(devices, {
      fields: [budgetPlanItems.deviceId],
      references: [devices.id],
    }),
  })
);
