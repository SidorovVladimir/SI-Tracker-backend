import { Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { db, DrizzleDB } from './db/client';

interface TokenPayload extends JwtPayload {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'user';
}

export interface Context {
  db: DrizzleDB;
  req: Request;
  res: Response;
  currentUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  } | null;
}
export const createContext = async ({
  req,
  res,
}: {
  req: Request;
  res: Response;
}): Promise<Context> => {
  let currentUser = null;
  const token = req.cookies?.auth_token;
  if (token) {
    try {
      const payload = jwt.verify(
        token,
        process.env.JWT_SECRET!
      ) as TokenPayload;

      const userExists = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, payload.id),
      });
      if (userExists) {
        currentUser = {
          id: userExists.id,
          firstName: userExists.firstName,
          lastName: userExists.lastName,
          email: userExists.email,
          role: userExists.role,
        };
      } else {
        console.warn('User from token not found in DB');
        res.clearCookie('auth_token');
      }
    } catch (err) {
      console.warn('invalid auth token', err);
    }
  }
  return { currentUser, req, res, db };
};
