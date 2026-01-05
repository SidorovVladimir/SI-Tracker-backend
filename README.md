# SI-Tracker Backend

## Описание проекта

SI-Tracker Backend - это серверная часть системы отслеживания средств измерений (SI - средства измерений). Проект предоставляет GraphQL API для управления пользователями, устройствами, верификациями, справочниками и локациями в системе метрологического контроля.

## Функциональность

- **Аутентификация и авторизация**: JWT-токены для безопасного доступа
- **Управление пользователями**: создание, обновление, удаление пользователей
- **Управление локациями**: города, компании, производственные площадки
- **Каталоги**: типы оборудования, типы измерений, типы метрологического контроля, статусы
- **Управление устройствами**: регистрация и отслеживание средств измерений
- **Верификация**: система верификации и контроля средств измерений

## Технологии

- **Node.js** - среда выполнения
- **TypeScript** - типизация
- **Express.js** - веб-фреймворк
- **Apollo Server** - GraphQL сервер
- **GraphQL** - язык запросов
- **Drizzle ORM** - ORM для работы с базой данных
- **PostgreSQL** - реляционная база данных
- **JWT** - аутентификация
- **bcrypt** - хэширование паролей
- **Zod** - валидация данных

## Установка и запуск

### Предварительные требования

- Node.js (версия 18+)
- PostgreSQL база данных
- npm или yarn

### Установка зависимостей

```bash
npm install
```

### Настройка переменных окружения

Создайте файл `.env` в корне проекта и заполните переменные на основе `.env.example`:

```env
DATABASE_URL=postgres://username:password@localhost:5432/database_name
PORT=4000
JWT_SECRET=your_jwt_secret_key
```

### Миграции базы данных

1. Генерация миграций:

```bash
npm run db:generate
```

2. Применение миграций:

```bash
npm run db:migrate
```

Или используйте Makefile команды:

```bash
make generate
make migrate
make push-db
```

### Запуск в режиме разработки

Для обычного режима:

```bash
npm run dev
```

Для режима работы (локальная БД):

```bash
npm run dev-work
```

### Сборка и запуск в продакшн

```bash
npm run build
npm start
```

## GraphQL API

Сервер предоставляет GraphQL API на порту 4000 (или указанном в переменной PORT).

### Основные схемы:

- **Auth**: `login`, `register`, `me`
- **User**: `users`, `createUser`, `updateUser`, `deleteUser`
- **City**: `cities`, `createCity`, `updateCity`, `deleteCity`
- **Company**: `companies`, `createCompany`, `updateCompany`, `deleteCompany`
- **ProductionSite**: `productionSites`, `createProductionSite`, `updateProductionSite`, `deleteProductionSite`
- **Catalog**: типы оборудования, измерений, контроля, статусы
- **Device**: управление устройствами и верификациями

Подробную документацию по GraphQL схемам можно найти в файлах `src/modules/*/schema/*.graphql`.

## Структура проекта

```
src/
├── context.ts              # Контекст GraphQL
├── db/                     # Конфигурация базы данных
├── graphql/                # Общие настройки GraphQL
├── modules/                # Модули приложения
│   ├── auth/               # Аутентификация
│   ├── catalog/            # Справочники
│   ├── device/             # Устройства
│   ├── location/           # Локации
│   └── user/               # Пользователи
├── utils/                  # Утилиты
└── index.ts                # Точка входа
```

## Скрипты

- `npm run dev` - запуск в режиме разработки с hot-reload
- `npm run dev-work` - запуск в режиме работы с локальной БД
- `npm start` - запуск собранного приложения
- `npm run build` - сборка TypeScript в JavaScript
- `npm run db:generate` - генерация миграций Drizzle
- `npm run db:migrate` - применение миграций

### Работа с базой данных

Проект использует Drizzle ORM для типобезопасной работы с PostgreSQL. Схемы моделей находятся в `src/modules/*/models/*.model.ts`.

## Лицензия

MIT License

## Автор

Sidorov Vladimir <v.sidorov29091988@gmail.com>

## Репозиторий

[GitHub](https://github.com/SidorovVladimir/SI-Tracker-backend)
