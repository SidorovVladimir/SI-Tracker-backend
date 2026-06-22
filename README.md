# SI-Tracker Backend

## Описание проекта

**SI-Tracker Backend** — серверная часть системы отслеживания средств измерений (СИ). Проект предоставляет GraphQL API для управления пользователями, устройствами, верификациями, справочниками и локациями в системе метрологического контроля. Включает интеграцию с ФГИС «Аршин», фоновые задачи (очереди BullMQ), аудит действий, чат, уведомления и аналитику.

## Функциональность

- **Аутентификация и авторизация**: JWT-токены, cookie-based сессии, разделение ролей (user / admin / superadmin)
- **Управление пользователями**: создание, обновление, удаление, привязка к компаниям
- **Управление локациями**: города, компании, производственные площадки
- **Каталоги**: типы оборудования, виды измерений, типы метрологического контроля, сферы применения, статусы, первичные эталоны, организации поверители
- **Управление устройствами (СИ)**: регистрация, отслеживание, паспорта, привязка к производственным участкам
- **Верификация**: планирование поверок, журнал партий, управление статусами верификации
- **Бюджетирование**: планирование бюджета поверок, затраты
- **Интеграция с ФГИС «Аршин»**: получение сведений о поверках из государственного реестра
- **Чат**: комнаты, сообщения между пользователями
- **Уведомления**: real-time уведомления через Socket.IO
- **Аудит**: логирование всех действий пользователей с детализацией
- **Аналитика**: агрегированные данные по устройствам, поверкам, затратам
- **Фоновые задачи**: очереди BullMQ (Redis), cron-задачи (напоминания о поверках, уведомления)
- **Admin-панель**: SQL-консоль для суперадминистратора, ручное управление БД

## Технологии

| Технология          | Назначение                    |
| ------------------- | ----------------------------- |
| **Node.js**         | Среда выполнения              |
| **TypeScript**      | Типизация                     |
| **Express.js**      | Веб-фреймворк                 |
| **Apollo Server 5** | GraphQL сервер                |
| **GraphQL**         | Язык запросов                 |
| **Drizzle ORM**     | ORM для работы с PostgreSQL   |
| **PostgreSQL**      | Основная база данных          |
| **Redis**           | Очереди (BullMQ), кэширование |
| **JWT**             | Аутентификация                |
| **bcrypt**          | Хэширование паролей           |
| **Zod**             | Валидация данных              |
| **Socket.IO**       | WebSocket для real-time       |
| **BullMQ**          | Фоновые очереди и задачи      |
| **node-cron**       | Планировщик cron-задач        |
| **ioredis**         | Redis-клиент                  |

## Установка и запуск

### Предварительные требования

- **Node.js** (версия 18+)
- **PostgreSQL** база данных
- **Redis** (для очередей BullMQ)
- **npm** или **yarn**

### Установка зависимостей

```bash
npm install
```

### Настройка переменных окружения

Создайте файл `.env` в корне проекта на основе `.env.example`:

```env
DATABASE_URL=postgres://username:password@localhost:5432/tracker
PORT=4000
JWT_SECRET=your_jwt_secret_key
REDIS_URL=redis://localhost:6379
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_password
ADMIN_FIRSTNAME=Имя
ADMIN_LASTNAME=Фамилия
GLOBAL_DEFAULT_LEAD_TIME_DAYS=30
```

### Работа с базой данных

Проект использует **Drizzle ORM** для типобезопасной работы с PostgreSQL. Схемы моделей находятся в `src/modules/*/models/*.model.ts`.

#### Генерация миграций

```bash
npm run db:generate
```

#### Применение миграций

```bash
npm run db:migrate
```

#### Push схемы в БД

```bash
make push-db
```

#### Проверка миграций

```bash
npm run db:check
```

#### Сидирование (заполнение тестовыми данными)

```bash
npm run db:seed
```

### Запуск в режиме разработки

```bash
npm run dev
```

### Запуск с локальной БД (PGlite)

```bash
npm run dev-work
```

### Сборка и запуск в продакшн

```bash
npm run build
npm start
```

## GraphQL API

Сервер предоставляет GraphQL API на порту 4000 (или указанном в переменной `PORT`).

### Основные модули и схемы:

- **Auth**: `login`, `register`, `logout`, `me`
- **User**: `users`, `user`, `createUser`, `updateUser`, `deleteUser`
- **City**: `cities`, `createCity`, `updateCity`, `deleteCity`
- **Company**: `companies`, `createCompany`, `updateCompany`, `deleteCompany`
- **ProductionSite**: `productionSites`, `createProductionSite`, `updateProductionSite`, `deleteProductionSite`
- **Catalog**: `equipmentTypes`, `measurementTypes`, `metrologyControlTypes`, `scopes`, `statuses`, `primaryStandarts`, `verificationOrganizations`
- **Device**: `devices`, `device`, `deviceCard`, `createDevice`, `updateDevice`, `deleteDevice`
- **Verification**: `verifications`, `planning`, `batches`
- **Budget**: `budgetItems`, `budgetPlanning`
- **Analytics**: общие и по производственным участкам
- **Chat**: `rooms`, `messages`, `sendMessage`
- **Notification**: `notifications`, `markRead`
- **AuditLog**: `auditLogs`
- **Arshin**: `searchArshin`, `getArshinVerification`

Подробную документацию по GraphQL схемам можно найти в файлах `src/modules/*/schema/*.graphql`.

## Структура проекта

```
src/
├── index.ts                       # Точка входа (Express + Apollo + Socket.IO)
├── context.ts                     # Контекст GraphQL
├── db/                            # Конфигурация базы данных
│   ├── client.ts                  # Клиент PostgreSQL / PGlite
│   ├── schema.ts                  # Экспорт схем Drizzle
│   ├── seed.ts                    # Сидирование
│   └── migration.ts               # Локальная миграция
├── graphql/                       # Общие настройки GraphQL
│   ├── typeDefs.ts                # Сборка typeDefs из модулей
│   └── resolvers.ts               # Сборка resolvers из модулей
├── middleware/                    # Промежуточные обработчики
│   ├── auth.ts                    # JWT-аутентификация
│   └── rateLimiter.ts             # Лимитер запросов
├── modules/                       # Модули приложения
│   ├── admin/                     # Управление (воркеры, SQL-консоль)
│   ├── analytics/                 # Аналитика (resolvers, schema, service)
│   ├── arshin/                    # Интеграция с ФГИС Аршин (dto, service)
│   ├── audit/                     # Аудит (model, service, queues, workers)
│   ├── auth/                      # Аутентификация (dto, resolvers, service)
│   ├── budget/                    # Бюджетирование (resolvers, schema, service)
│   ├── catalog/                   # Справочники (dto, models, resolvers, service)
│   ├── chat/                      # Чат (models, resolvers, schema, service)
│   ├── device/                    # Устройства (dto, models, queues)
│   ├── location/                  # Локации (города, компании, участки)
│   └── notification/              # Уведомления
├── queues/                        # Конфигурация очередей
│   └── cron.queue.ts              # Cron-очередь
├── redis/                         # Redis-клиент
│   └── client.ts
├── utils/                         # Утилиты
│   ├── auth.ts                    # JWT-helper
│   ├── cache.ts                   # Кэширование
│   └── errors.ts                  # Кастомные ошибки
└── workers/                       # Воркеры BullMQ
    ├── index.ts                   # Регистрация воркеров
    └── cron.worker.ts             # Cron-задачи
```

## Аутентификация

- Аутентификация через JWT, токен передается в cookie `token`
- При регистрации первого пользователя создается суперадминистратор (учетные данные из `.env`)
- Роли: `user` (обычный пользователь), `admin` (администратор), `superadmin` (суперадминистратор)

## Фоновые задачи

Проект использует **BullMQ** (на базе Redis) для фоновых задач:

- **Cron-задачи**: напоминания о предстоящих поверках, уведомления
- **Audit-воркеры**: асинхронная запись логов аудита
- **Admin-воркеры**: фоновые операции администрирования

Задачи запускаются через воркеры в `src/workers/` и очередь в `src/queues/`.

## Работа с базой данных

- **Drizzle ORM**: схемы описаны в `src/modules/*/models/*.model.ts`
- **PostgreSQL**: основная БД
- **PGlite**: локальный режим для разработки (`npm run dev-work`)
- Миграции управляются через `drizzle-kit`

## Скрипты

| Скрипт                | Описание                                |
| --------------------- | --------------------------------------- |
| `npm run dev`         | Запуск в режиме разработки с hot-reload |
| `npm run dev-work`    | Запуск с локальной БД (PGlite)          |
| `npm start`           | Запуск собранного приложения            |
| `npm run build`       | Сборка TypeScript в JavaScript          |
| `npm run db:generate` | Генерация миграций Drizzle              |
| `npm run db:migrate`  | Применение миграций                     |
| `npm run db:check`    | Проверка миграций                       |
| `npm run db:seed`     | Заполнение БД тестовыми данными         |

### Makefile

| Команда         | Описание            |
| --------------- | ------------------- |
| `make push-db`  | Push схемы в БД     |
| `make generate` | Генерация миграций  |
| `make migrate`  | Применение миграций |
| `make db-check` | Проверка миграций   |

## Лицензия

MIT License

## Автор

Sidorov Vladimir <v.sidorov29091988@gmail.com>

## Репозиторий

[GitHub](https://github.com/SidorovVladimir/SI-Tracker-backend)
