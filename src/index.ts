import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import express from 'express';
import { createServer } from 'http';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { typeDefs } from './graphql/typeDefs';
import { resolvers } from './graphql/resolvers';
import { createContext } from './context';
import { exec } from 'child_process';
import { authMiddleware } from './middleware/auth';

async function startApolloServer() {
  const app = express();
  const httpServer = createServer(app);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      ApolloServerPluginLandingPageDisabled(),
    ],
  });

  await server.start();

  app.use(
    cors<cors.CorsRequest>({
      origin: true,
      credentials: true,
    })
  );

  // app.use(
  //   '/graphql',
  //   cors<cors.CorsRequest>({
  //     // origin: ['http://localhost:5173', 'http://localhost:4173'],
  //     origin: true,
  //     credentials: true,
  //   }),
  //   express.json({ limit: '50mb' }),
  //   cookieParser(),
  //   expressMiddleware(server, {
  //     context: createContext,
  //   })
  // );

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());
  app.use(authMiddleware);

  // const user = (req as any).currentUser;
  // if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
  //   return res
  //     .status(403)
  //     .send('Доступ запрещен: требуется роль администратора');
  // }

  app.get('/api/admin/backup', (req, res) => {
    const cookies = req.cookies;

    if (!cookies || !cookies['auth_token']) {
      return res.status(401).send('Доступ запрещен: требуется авторизация');
    }

    // 2. Подтягиваем параметры подключения из env-конфига
    const dbUser = process.env.DB_USER;
    const dbName = process.env.DB_NAME;
    const dbHost = process.env.DB_HOST;
    const dbPassword = process.env.DB_PASSWORD;

    // Формируем красивое имя файла: si_tracker_backup_2026-06-08.sql
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `si_tracker_backup_${dateStr}.sql`;

    // Передаем пароль в переменные окружения процесса, чтобы утилита pg_dump не запрашивала его в терминале
    const env = { ...process.env, PGPASSWORD: dbPassword };

    // Команда генерации сырого дампа структуры и данных (-F p означает plain text, обычный sql-скрипт)
    const command = `pg_dump -h ${dbHost} -U ${dbUser} -F p ${dbName}`;

    // Настраиваем HTTP-заголовки ответа, чтобы браузер запустил скачивание файла
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/sql');

    // Запускаем процесс pg_dump
    const dumpProcess = exec(command, { env, maxBuffer: 1024 * 1024 * 50 }); // Ограничение на буфер до 50мб

    // Напрямую стримим текстовый вывод pg_dump в сетевой ответ Express!
    dumpProcess.stdout?.pipe(res);

    // Перехватываем критические системные сбои
    dumpProcess.on('error', (err) => {
      console.error('Ошибка выполнения pg_dump на сервере:', err);
      if (!res.headersSent) {
        res
          .status(500)
          .send('Не удалось сгенерировать резервную копию базы данных');
      }
    });
  });

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: createContext,
    })
  );

  const PORT = process.env.PORT || 4000;
  await new Promise<void>((resolve) =>
    httpServer.listen({ port: PORT }, resolve)
  );
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
}

startApolloServer().catch(console.error);
