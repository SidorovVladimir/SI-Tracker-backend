import { z } from 'zod';

export const CreateUserInputSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(50, 'Имя должно быть не более 50 символов'),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(50, 'Фамилия должна быть не более 50 символов'),
  email: z.email('Некорректный формат почты'),
  password: z
    .string()
    .min(8, 'Пароль должен состоять как минимум из 8 символов'),
});

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;
