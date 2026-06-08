import { z } from 'zod';

export const ArshinVriResponseSchema = z.object({
  result: z.object({
    count: z.number(),
    items: z.array(
      z.object({
        vri_id: z.string(),
        org_title: z.string(),
        mit_number: z.string(),
        mi_number: z.string(),
        verification_date: z.string(), // Например: "2019-10-08T12:00:00Z"
        valid_date: z.string().optional().nullable(), // Может быть null
        result_docnum: z.string().optional().nullable(), // Например: "Нет данных" или номер
        applicability: z.boolean(), // true - годен, false - брак
      })
    ),
  }),
});
