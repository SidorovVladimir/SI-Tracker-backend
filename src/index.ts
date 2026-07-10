import { ApolloServer, ApolloServerPlugin } from '@apollo/server';
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
import { spawn } from 'child_process';
import { authMiddleware } from './middleware/auth';
import { Server } from 'socket.io';
import { verifyToken } from './utils/auth';
import { db } from './db/client';
import { chatMessages } from './modules/chat/models/message.model';

import { ChatService } from './modules/chat/service/chat.service';

import { initAllWorkers, shutdownAllWorkers } from './workers';
import fs from 'fs';
import path from 'path';
import { dbRestoreQueue } from './modules/admin/workers/restore.worker';
import { checkRateLimit, RATE_LIMITS } from './middleware/rateLimiter';

export let io: Server;

async function startApolloServer() {
  const app = express();
  const httpServer = createServer(app);

  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    path: '/socket.io/',
  });

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

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());
  app.use(authMiddleware);

  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) {
        return next(new Error('Authentication error: Cookies missing'));
      }

      // 1. Вытаскиваем именно ваш auth_token из строки кук
      const tokenCookie = cookieHeader
        .split('; ')
        .find((row) => row.startsWith('auth_token='));

      if (!tokenCookie) {
        return next(new Error('Authentication error: Token missing'));
      }

      const token = tokenCookie.split('=')[1];
      if (!token) {
        return next(new Error('Authentication error: Token empty'));
      }

      // 2. Валидируем токен вашей готовой функцией verifyToken
      const payload = verifyToken(token);
      if (!payload || !payload.id) {
        return next(new Error('Authentication error: Invalid token'));
      }

      // 3. Проверяем существование пользователя в базе данных через Drizzle
      const userExists = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, payload.id),
      });

      if (!userExists) {
        return next(new Error('Authentication error: User not found'));
      }

      // 4. Складываем данные пользователя в контекст сокета (как в Express клали в req.currentUser)
      socket.data.user = {
        id: userExists.id,
        firstName: userExists.firstName,
        lastName: userExists.lastName,
        login: userExists.login,
        role: userExists.role,
      };

      next();
    } catch (err) {
      return next(new Error('Authentication error: Internal server error'));
    }
  });

  const activeRooms = new Map<string, string | null>();

  const onlineSockets = new Map<string, { userId: string; isIdle: boolean }>();

  const broadcastOnlineStatus = () => {
    const usersMap = new Map<string, { userId: string; isIdle: boolean }>();

    for (const info of onlineSockets.values()) {
      const existing = usersMap.get(info.userId);
      // Если хотя бы одна вкладка активна (isIdle === false), пользователь в сети!
      if (!existing || !info.isIdle) {
        usersMap.set(info.userId, info);
      }
    }
    io.emit('updateOnlineStatus', Array.from(usersMap.values()));
  };

  //  Обработка сокет-соединений
  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) return socket.disconnect();

    const userId = user.id.toLowerCase().trim();

    // Помещаем сокет сотрудника в его персональную комнату по UUID
    socket.join(userId);

    activeRooms.set(socket.id, null); // При подключении окон открытых нет
    // console.log(
    //   `Сотрудник [${user.firstName} ${user.lastName}] успешно подключился. Socket ID: ${socket.id}`
    // );

    onlineSockets.set(socket.id, { userId, isIdle: false });
    broadcastOnlineStatus();
    // console.log(`Сотрудник [${user.firstName}] зашел в систему.`);

    // 2. НОВЫЙ ОБРАБОТЧИК: Ловим смену фонового режима от вашего useEffect!
    socket.on('setUserIdleStatus', (data: { isIdle: boolean }) => {
      const currentInfo = onlineSockets.get(socket.id);
      if (currentInfo) {
        currentInfo.isIdle = data.isIdle;
        broadcastOnlineStatus();
      }
    });

    socket.on('joinChatRoom', (data: { companionId: string | null }) => {
      if (data.companionId) {
        activeRooms.set(socket.id, data.companionId.toLowerCase().trim());
        // console.log(
        //   ` Сотрудник [${user.firstName}] открыл чат с ${data.companionId}`
        // );
      } else {
        activeRooms.set(socket.id, null);
      }
    });

    // Слушатель чата между сотрудниками с rate limiter
    socket.on(
      'sendMessage',
      async (data: { recipientId: string; text: string }) => {
        // Rate limiting: не более 30 сообщений в минуту
        const allowed = await checkRateLimit(
          userId,
          'sendMessage',
          RATE_LIMITS.SEND_MESSAGE.max,
          RATE_LIMITS.SEND_MESSAGE.windowMs
        );
        if (!allowed) {
          return socket.emit('rateLimited', {
            message: 'Слишком много сообщений. Подождите минуту.',
          });
        }

        const { recipientId, text } = data;
        const cleanRecipientId = recipientId.toLowerCase().trim();

        try {
          // 1. Сохраняем сообщение в базу данных PostgreSQL
          const [insertedMessage] = await db
            .insert(chatMessages)
            .values({
              senderId: userId,
              recipientId: cleanRecipientId,
              text: text,
              isRead: false,
            })
            .returning();

          if (!insertedMessage) return;

          // 2. Мгновенно пересылаем сообщение получателю в его сокет-комнату
          io.to(cleanRecipientId).emit('newMessage', insertedMessage);

          // 3. Отправляем подтверждение самому отправителю (чтобы сообщение появилось на его экране)
          socket.emit('messageSentConfirmation', insertedMessage);

          // 3.УМНЫЙ ПОДСЧЕТ СЧЕТЧИКОВ НА БЭКЕНДЕ:
          // Ищем сокеты ПОЛУЧАТЕЛЯ и проверяем, открыт ли у него чат с ОТПРАВИТЕЛЕМ прямо сейчас
          const recipientSockets = await io.in(cleanRecipientId).fetchSockets();
          const chatService = new ChatService(db);

          let shouldSendUpdate = true;
          let isRecipientLookingAtMe = false;

          for (const rSocket of recipientSockets) {
            const currentOpenChatInBrowser = activeRooms.get(rSocket.id);
            // Если у получателя в браузере прямо сейчас открыт чат со мной (отправителем)
            if (currentOpenChatInBrowser === userId) {
              shouldSendUpdate = false; // Блокируем рассылку счетчика, он в активном диалоге!
              isRecipientLookingAtMe = true;
              break;
            }
          }

          if (shouldSendUpdate) {
            const recipientUnreadCount = await chatService.getTotalUnreadCount(
              cleanRecipientId
            );
            io.to(cleanRecipientId).emit('updateUnreadCount', {
              count: isRecipientLookingAtMe ? 0 : recipientUnreadCount,
              forceRefetchDialogs: true,
            });
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on(
      'notifyMessagesRead',
      (data: { readerId: string; authorId: string }) => {
        const cleanAuthorId = data.authorId.toLowerCase().trim();
        const cleanReaderId = data.readerId.toLowerCase().trim();
        io.to(cleanAuthorId).emit('messagesMarkedAsRead', {
          senderId: cleanAuthorId,
          recipientId: cleanReaderId,
        });
      }
    );

    socket.on('disconnect', async () => {
      activeRooms.delete(socket.id);
      onlineSockets.delete(socket.id);
      broadcastOnlineStatus();
      // console.log(`Вкладка сотрудника [${user.firstName}] закрыта.`);
    });
  });

  app.get('/api/admin/backup', (req, res) => {
    const user = (req as any).currentUser;
    if (!user || user.role !== 'superadmin') {
      return res
        .status(403)
        .send('Доступ запрещен: требуется роль администратора');
    }

    const dbUser = process.env.DB_USER!;
    const dbName = process.env.DB_NAME!;
    const dbHost = process.env.DB_HOST!;
    const dbPassword = process.env.DB_PASSWORD!;

    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `si_tracker_backup_${dateStr}.sql`;

    // 1. ЗАГОЛОВКИ СТАВИМ СРАЗУ. Начинаем стриминг в режиме HTTP-ответа 200.
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/sql');

    const dumpProcess = spawn(
      'pg_dump',
      ['-h', dbHost, '-U', dbUser, '--clean', '--if-exists', '-F', 'p', dbName],
      { env: { ...process.env, PGPASSWORD: dbPassword } }
    );

    // 2. СТРИМИНГ НАПРЯМУЮ: Данные от pg_dump чанками (порциями по несколько КБ)
    // летят сразу в сеть пользователю, минуя оперативную память Node.js.
    dumpProcess.stdout.pipe(res);

    let errorLog = '';
    dumpProcess.stderr.on('data', (chunk: Buffer) => {
      errorLog += chunk.toString();
    });

    dumpProcess.on('error', (err) => {
      console.error('[Backup] Системная ошибка pg_dump:', err.message);
      // Если заголовки ответа еще не ушли клиенту, отдаем честный 500
      if (!res.headersSent) {
        res
          .status(500)
          .send('Не удалось сгенерировать резервную копию базы данных');
      } else {
        res.destroy(); // Иначе принудительно рвем поток, чтобы файл не скачался битым
      }
    });

    dumpProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(
          `[Backup] pg_dump завершился с ошибкой (код ${code}): ${errorLog}`
        );

        if (!res.headersSent) {
          res.status(500).send(`Ошибка при генерации дампа: ${errorLog}`);
        } else {
          // Если pg_dump упал на середине файла, рвем сокет подключения,
          // чтобы у администратора прервалась загрузка файла в браузере (сетевая ошибка).
          // Это защитит систему от сохранения "обрезанного", поврежденного SQL-файла.
          res.destroy();
        }
        return;
      }

      console.log(
        `[Backup] Дамп базы данных "${dbName}" успешно отправлен пользователю.`
      );
    });
  });

  app.post('/api/admin/restore', (req, res) => {
    const user = (req as any).currentUser;
    if (!user || user.role !== 'superadmin') {
      return res
        .status(403)
        .send('Доступ запрещен: требуется роль суперадминистратора');
    }

    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const tempFilePath = path.join(
      uploadDir,
      `backup_restore_${Date.now()}.sql`
    );
    const writeStream = fs.createWriteStream(tempFilePath);

    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      try {
        const job = await dbRestoreQueue.add('restore-job', {
          filePath: tempFilePath,
          userId: user.id,
        });

        res.status(202).json({
          success: true,
          jobId: job.id,
          message:
            'Файл дампа успешно загружен. Процесс восстановления базы данных запущен в изолированном фоновом режиме.',
        });
      } catch (err: any) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        res
          .status(500)
          .send(`Не удалось поставить задачу в очередь: ${err.message}`);
      }
    });

    writeStream.on('error', (err) => {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      res.status(500).send(`Ошибка при загрузке файла дампа: ${err.message}`);
    });
  });

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: createContext,
    })
  );

  const PORT = process.env.PORT || 4000;

  initAllWorkers();
  await new Promise<void>((resolve) =>
    httpServer.listen({ port: PORT }, resolve)
  );
  console.log(`Server ready at http://localhost:${PORT}/graphql`);
  console.log(`WebSockets ready at ws://localhost:${PORT}`);
  console.log(
    `Фоновые задачи (Очереди + Кроны BullMQ) успешно инициализированы.`
  );
}

const handleShutdown = async () => {
  console.log('Получен сигнал на остановку сервера...');
  await shutdownAllWorkers(); // Останавливаем все воркеры BullMQ
  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

startApolloServer().catch(console.error);
