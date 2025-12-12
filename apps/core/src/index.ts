// import { Elysia } from "elysia";

// const app = new Elysia().get("/", () => "Hello Elysia").listen(3333);

// export type App = typeof app;

// console.log(
//   `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
// );

import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";

const app = new Elysia()
  .use(
    cors({
      origin: "http://localhost:3000",
      credentials: true,
    }),
  )
  .get("/", () => ({ message: "Hello from Elysia!", id: "1" }))

  .get("/api/users", () => ({
    users: [
      { id: 1, name: "John Doe", email: "john@example.com" },
      { id: 2, name: "Jane Smith", email: "jane@example.com" },
      { id: 3, name: "Bob Johnson", email: "bob@example.com" },
    ],
  }))

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

  .listen(3333);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

export { app };
export type App = typeof app;


