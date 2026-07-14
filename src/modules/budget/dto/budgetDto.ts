import { z } from 'zod';

export const BudgetCalculationMethodSchema = z.enum(['pricelist', 'history']);

export const BudgetPlanFilterInputSchema = z.object({
  matchMethod: z.string().optional(),
  // productionSiteId: z.uuid().optional(),
  searchQuery: z.string().optional(),
  city: z.uuid().optional(),
  company: z.uuid().optional(),
  productionSite: z.uuid().optional(),
});

export const CreateBudgetPlanInputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    comment: z.string().optional(),
    vatRate: z.number(),
    calculationMethod: BudgetCalculationMethodSchema,
    pricelistIds: z.array(z.uuid()).optional(),
    cityId: z.uuid().optional(),
    companyId: z.uuid().optional(),
    productionSiteId: z.uuid().optional(),
  })
  .refine(
    (data) => {
      // Если метод "pricelist", то массив pricelistIds обязан быть и не должен быть пустым
      if (data.calculationMethod === 'pricelist') {
        return !!data.pricelistIds && data.pricelistIds.length > 0;
      }
      return true;
    },
    {
      message:
        "Для метода расчета 'PRICELIST' необходимо выбрать как минимум один прайс-лист.",
      path: ['pricelistIds'], // Ошибка подсветит конкретное поле на фронтенде
    }
  );

export const UpdateBudgetPlanItemPriceInputSchema = z.object({
  itemId: z.uuid(),
  manualPrice: z.number().positive(),
});

export const PricelistItemInputSchema = z.object({
  grsiNumber: z.string().optional(),
  csmCode: z.string().optional(),
  // name: z.string().min(1),
  // modelOrType: z.string().optional(),
  price: z.number().nonnegative(),
});

export const CreatePricelistInputSchema = z.object({
  verificationOrganizationId: z.uuid(),
  title: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  isRegulated: z.boolean(),
  items: z.array(PricelistItemInputSchema),
});
