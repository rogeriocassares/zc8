import { treaty } from "@elysiajs/eden";
import type { app } from "../../../apps/core/src/index";

export const api = treaty<app>("http://localhost:3333");
