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

  app.get('/api/admin/backup', (req, res) => {
    const user = (req as any).currentUser;
    if (!user || user.role !== 'superadmin') {
      return res
        .status(403)
        .send('Доступ запрещен: требуется роль администратора');
    }

    const dbUser = process.env.DB_USER;
    const dbName = process.env.DB_NAME;
    const dbHost = process.env.DB_HOST;
    const dbPassword = process.env.DB_PASSWORD;

    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `si_tracker_backup_${dateStr}.sql`;

    const env = { ...process.env, PGPASSWORD: dbPassword };

    const command = `pg_dump -h ${dbHost} -U ${dbUser} --clean --if-exists -F p ${dbName}`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/sql');

    const dumpProcess = exec(command, { env, maxBuffer: 1024 * 1024 * 50 });

    dumpProcess.stdout?.pipe(res);

    dumpProcess.on('error', (err) => {
      console.error('Ошибка выполнения pg_dump на сервере:', err);
      if (!res.headersSent) {
        res
          .status(500)
          .send('Не удалось сгенерировать резервную копию базы данных');
      }
    });
  });

  app.post('/api/admin/restore', (req, res) => {
    const user = (req as any).currentUser;
    if (!user || user.role !== 'superadmin') {
      return res
        .status(403)
        .send('Доступ запрещен: требуется роль администратора');
    }

    const dbUser = process.env.DB_USER;
    const dbName = process.env.DB_NAME;
    const dbHost = process.env.DB_HOST;
    const dbPassword = process.env.DB_PASSWORD;

    const env = { ...process.env, PGPASSWORD: dbPassword };

    const command = `psql -h ${dbHost} -U ${dbUser} -d ${dbName}`;

    const restoreProcess = exec(command, { env });

    req.pipe(restoreProcess.stdin!);

    let errorLog = '';
    restoreProcess.stderr?.on('data', (chunk) => {
      errorLog += chunk;
    });

    restoreProcess.on('close', (code) => {
      if (code === 0) {
        console.log('📦 База данных успешно восстановлена из дампа!');
        res.status(200).send('База данных успешно восстановлена');
      } else {
        console.error('Ошибка psql при восстановлении:', errorLog);
        res.status(500).send(`Ошибка восстановления базы данных: ${errorLog}`);
      }
    });

    restoreProcess.on('error', (err) => {
      console.error('Системная ошибка psql:', err);
      res.status(500).send('Критический сбой процесса psql');
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
