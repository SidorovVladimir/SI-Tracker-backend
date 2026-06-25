import { z } from 'zod';

export const BudgetPlanFilterInputSchema = z
  .object({
    matchMethod: z.string().optional(),
    productionSiteId: z.string().uuid().optional(),
    searchQuery: z.string().optional(),
  })
  .optional();

export const CreateBudgetPlanInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  comment: z.string().optional(),
  pricelistIds: z.array(z.string().uuid()),
});

export const UpdateBudgetPlanItemPriceInputSchema = z.object({
  itemId: z.string().uuid(),
  manualPrice: z.number().positive(),
});

export const PricelistItemInputSchema = z.object({
  grsiNumber: z.string().optional(),
  csmCode: z.string().optional(),
  name: z.string().min(1),
  modelOrType: z.string().optional(),
  price: z.number().nonnegative(),
});

export const CreatePricelistInputSchema = z.object({
  verificationOrganizationId: z.string().uuid(),
  title: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  isRegulated: z.boolean(),
  items: z.array(PricelistItemInputSchema),
});
