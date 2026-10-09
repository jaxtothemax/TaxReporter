/**
 * The worker's lockdown, as a module of its own that the worker imports
 * before any other: ES modules run in import order, so no module the worker
 * loads can take hold of `fetch` or the rest before they are gone.
 */
import { lockDown } from "./lockdown";

lockDown(globalThis);
