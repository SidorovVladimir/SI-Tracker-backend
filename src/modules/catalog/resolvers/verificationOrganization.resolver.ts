import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { MetrologyControlTypeService } from '../service/metrologyControlType.service';
import { CreateMetrologyControlTypeInputSchema } from '../dto/CreateMetrologyControlTypeDto';
import { VerificationOrganizationService } from '../service/verificationOrganization.service';
import { CreateVerificationOrganizationInputSchema } from '../dto/CreateVerificationOrganizationDto';

export const Query = {
  verificationOrganizations: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new VerificationOrganizationService(
      db
    ).getVerificationOrganizations();
  },
  verificationOrganization: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {},
};

export const Mutation = {
  createVerificationOrganization: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput =
        CreateVerificationOrganizationInputSchema.parse(input);

      return await new VerificationOrganizationService(
        db
      ).createVerificationOrganization(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateVerificationOrganization: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deleteVerificationOrganization: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new VerificationOrganizationService(
      db
    ).deleteVerificationOrganization(id);
  },
};
