import { NextFunction } from 'express';
import { Request, Response } from 'express';
import { verifyToken } from '../utils/auth';
import { db } from '../db/client';

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
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
  } catch (error) {
    return res.status(500).send('Внутренняя ошибка при проверке авторизации');
  }
};
// import { NextFunction, Request, Response } from 'express';
// import { verifyToken } from '../utils/auth';

// export const authMiddleware = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   try {
//     const token = req.cookies?.auth_token;

//     if (!token) {
//       return next(); // Токена нет — идем дальше, req.currentUser останется undefined
//     }

//     // Расшифровываем токен. Метод вернет объект TokenPayload (id, login, firstName, lastName, role)
//     const payload = verifyToken(token);

//     if (!payload) {
//       // Если токен "протух" или подделан — очищаем куку, чтобы фронтенд понял, что сессия умерла
//       res.clearCookie('auth_token', { path: '/' });
//       return res
//         .status(401)
//         .send('Невалидный или просроченный токен авторизации');
//     }

//     // Подкладываем данные из JWT-токена в запрос БЕЗ обращения к базе данных!
//     (req as any).currentUser = {
//       id: payload.id,
//       login: payload.login,
//       firstName: payload.firstName,
//       lastName: payload.lastName,
//       role: payload.role, // Благодаря этому ваша проверка user.role === 'user' отработает моментально
//     };

//     next();
//   } catch (error) {
//     // Защита сервера от падения при непредвиденных сбоях парсинга кук
//     return res
//       .status(500)
//       .send('Внутренняя ошибка сервера при проверке авторизации');
//   }
// };
