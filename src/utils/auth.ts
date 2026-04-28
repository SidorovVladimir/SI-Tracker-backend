import bcrypt from 'bcrypt';
import { Response } from 'express';
import { User } from '../modules/user/user.types';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPasword(
  password: string,
  userPassword: string
): Promise<boolean> {
  return await bcrypt.compare(password, userPassword);
}

export const setAuthCookie = (res: Response, user: User) => {
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  res.cookie('auth_token', token, {
    httpOnly: true,
    // secure: true,
    // sameSite: 'strict',
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};
