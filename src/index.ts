import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import express from 'express';
import { createServer } from 'http';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { typeDefs } from './graphql/typeDefs';
import { resolvers } from './graphql/resolvers';
import { createContext } from './context';

async function startApolloServer() {
  const app = express();
  const httpServer = createServer(app);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  await server.start();

  app.use(
    '/graphql',
    cors<cors.CorsRequest>({
      origin: ['http://localhost:5173', 'http://localhost:4173'],
      credentials: true,
    }),
    express.json(),
    cookieParser(),
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
