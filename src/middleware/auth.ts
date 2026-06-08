import { NextFunction } from 'express';
import { Request, Response } from 'express';
import { verifyToken } from '../utils/auth';
import { db } from '../db/client';

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.cookies?.auth_token;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const userExists = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, payload.id),
      });
      if (userExists) {
        (req as any).currentUser = { ...userExists };
      }
    }
  }
  next();
};
