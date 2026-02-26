push-db:
	npx drizzle-kit push
generate:
	npx drizzle-kit generate --name=$(name)
migrate:
	npx drizzle-kit migrate
db-check:
	npx drizzle-kit check