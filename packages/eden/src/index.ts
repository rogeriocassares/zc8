import { treaty } from "@elysiajs/eden";
// import type { App } from "@repo/core";
import type { App } from "../../../apps/core/src";

export const api = treaty<App>('http://localhost:3333')

