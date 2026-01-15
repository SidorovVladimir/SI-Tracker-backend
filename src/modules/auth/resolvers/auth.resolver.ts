import { ZodError } from 'zod';
import { CreateUserInputSchema } from '../../user/dto/CreateUserDto';
import { AuthenticationError, formatZodErrors } from '../../../utils/errors';
import { AuthService } from '../service/auth.service';
import { setAuthCookie } from '../../../utils/auth';
import { Context } from '../../../context';

export const Query = {
  me: (_: unknown, __: unknown, { currentUser }: Context) => {
    if (!currentUser) {
      throw new AuthenticationError();
    }
    return currentUser;
  },
};

export const Mutation = {
  register: async (
    _: unknown,
    {
      input,
    }: {
      input: unknown;
    },
    { db, res }: Context
  ) => {
    try {
      const validatedInput = CreateUserInputSchema.parse(input);
      const user = await new AuthService(db).register(validatedInput);
      setAuthCookie(res, user);
      return {
        success: true,
        user,
      };
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  login: async (
    _: unknown,
    { input }: { input: { email: string; password: string } },
    { res, db }: Context
  ) => {
    try {
      const user = await new AuthService(db).Login(input);
      setAuthCookie(res, user);
      return {
        success: true,
        user,
      };
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  logout: async (_: unknown, __: unknown, { res }: Context) => {
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    return true;
  },
};
