import { z } from 'zod';
// import { CreateUserInputSchema } from './CreateUserDto';

// export const UpdateUserInputSchema = CreateUserInputSchema.omit({
//   email: true,
//   password: true,
// });

export const UpdateUserInputSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(50, 'Имя должно быть не более 50 символов'),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(50, 'Фамилия должна быть не более 50 символов'),
  role: z.enum(['admin', 'user']),
});

export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;
