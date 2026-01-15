// import { Elysia } from "elysia";

// const app = new Elysia().get("/", () => "Hello Elysia").listen(3333);

// export type App = typeof app;

// console.log(
//   `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
// );

import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import { createClient } from 'redis';
// import { async } from '../../web/.next/dev/types/routes';

// Define types
type RedisStreamMessage = {
  id: string;
  message: {
    orgId: string;
    data: string;
    timestamp: string;
  };
};

// Redis client
const redis = createClient({ url: 'redis://localhost:6379' });
await redis.connect();
const app = new Elysia()
  .use(
    cors({
      origin: "http://localhost:3000",
      credentials: true,
    }),
  )

  .get("/", () => ({ message: "Hello from Elysia!", id: "1" }))
  .get(
    '/events',
    async ({ set }) => {
      set.headers['Content-Type'] = 'text/event-stream';
      set.headers['Cache-Control'] = 'no-cache';
      set.headers['Connection'] = 'keep-alive';
      set.headers['Content-Encoding'] = 'none';

      const streamKey = 'stream:{org123}:data';

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(`data: {"status":"connected"}\n\n`);

          let lastId = '$';
          let isAborted = false;

          // Manual abort tracking
          if ((controller as any).signal?.aborted) {
            isAborted = true;
          } else {
            (controller as any).signal?.addEventListener('abort', () => {
              isAborted = true;
            });
          }

          const read = async () => {
            while (!isAborted) {
              try {
                const result = await redis.xRead(
                  { key: 'stream:{org123}:data', id: lastId },
                  { BLOCK: 5000, COUNT: 1 }
                );

                if (isAborted) break;

                if (result) {
                  for (const { id, message } of result[0].messages) {
                    controller.enqueue(`data: ${JSON.stringify({ id, message })}\n\n`);
                    lastId = id;
                  }
                }
              } catch (err) {
                if (!isAborted) {
                  controller.enqueue(`data: {"error":"${(err as Error).message}"}\n\n`);
                }
                break;
              }
            }

            controller.close();
          };

          read();
        }
      });

      return stream;
    },
    {
      response: t.Unknown(),
    }
  )
  .get("/api/users/:id", ({ params }: { params: { id: string } }) => {
    const id = params.id;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return {
        status: 400,
        body: { message: "Invalid user ID" },
      };
    }

    return {
      user: {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
        createdAt: new Date().toISOString(),
      },
    };
  })

  .post(
    "/api/users",
    ({ body }) => ({
      success: true,
      user: {
        id: Math.floor(Math.random() * 1000),
        name: body.name,
        email: body.email,
        createdAt: new Date().toISOString(),
      },
    }),
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        email: t.String({ format: "email" }),
      }),
    },
  )

  .delete("/api/users/:id", ({ params: { id } }) => ({
    success: true,
    message: `User ${id} deleted`,
  }))

  .listen({
    port: 3333,
    hostname: '0.0.0.0'
  });

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

export { app };
export type App = typeof app;


