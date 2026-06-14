import { Queue, Worker, Job } from 'bullmq';
import { redisForQueue } from '../../../redis/client';
import { spawn } from 'child_process';
import fs from 'fs';
import { io } from '../../../index'; // Импорт вашего сокет-сервера для пушей суперадмину

// 1. Создаем очередь восстановления
export const dbRestoreQueue = new Queue('db-restore', {
  connection: redisForQueue as any,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3600 },
  },
});

export let isMaintenanceMode = false;

export const createRestoreWorker = () => {
  return new Worker(
    'db-restore',
    async (job: Job) => {
      const { filePath } = job.data;

      console.log(
        `[Restore Worker] Начат процесс восстановления БД из файла: ${filePath}`
      );

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Включаем режим тех. работ: блокируем GraphQL API
      isMaintenanceMode = true;
      if (io) io.emit('maintenance-status', { isMaintenance: true });

      const dbUser = process.env.DB_USER!;
      const dbName = process.env.DB_NAME!;
      const dbHost = process.env.DB_HOST!;
      const dbPassword = process.env.DB_PASSWORD!;

      return new Promise((resolve, reject) => {
        const restoreProcess = spawn(
          'psql',
          ['-h', dbHost, '-U', dbUser, '-d', dbName, '-f', filePath],
          { env: { ...process.env, PGPASSWORD: dbPassword } }
        );

        let errorLog = '';
        restoreProcess.stderr.on('data', (chunk: Buffer) => {
          errorLog += chunk.toString();
        });

        restoreProcess.on('close', (code) => {
          // В любом случае удаляем временный файл дампа с диска, чтобы не забивать место
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }

          // Выключаем режим тех. работ
          isMaintenanceMode = false;
          if (io) io.emit('maintenance-status', { isMaintenance: false });

          if (code === 0) {
            console.log('[Restore Worker] База данных успешно восстановлена!');

            // Оповещаем суперадмина по сокетам об успехе
            if (io) {
              io.emit('job-status-changed', {
                jobId: job.id,
                name: 'db-restore',
                status: 'completed',
              });
            }
            resolve({ success: true });
          } else {
            console.error('[Restore Worker] Ошибка psql:', errorLog);

            // Оповещаем суперадмина о провале
            if (io) {
              io.emit('job-status-changed', {
                jobId: job.id,
                name: 'db-restore',
                status: 'failed',
                error: errorLog,
              });
            }
            reject(new Error(`Ошибка psql (код ${code}): ${errorLog}`));
          }
        });
      });
    },
    { connection: redisForQueue as any, concurrency: 1 }
  );
};
