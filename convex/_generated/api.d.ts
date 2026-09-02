/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as auth from "../auth.js";
import type * as authGuard from "../authGuard.js";
import type * as authQuery from "../authQuery.js";
import type * as catchupConfig from "../catchupConfig.js";
import type * as catchupLogic from "../catchupLogic.js";
import type * as catchups from "../catchups.js";
import type * as clickup from "../clickup.js";
import type * as clickupConfig from "../clickupConfig.js";
import type * as clickupMutations from "../clickupMutations.js";
import type * as clickupOAuth from "../clickupOAuth.js";
import type * as clickupOAuthConfig from "../clickupOAuthConfig.js";
import type * as clickupOAuthNode from "../clickupOAuthNode.js";
import type * as correos from "../correos.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as songs from "../songs.js";
import type * as subtasks from "../subtasks.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  auth: typeof auth;
  authGuard: typeof authGuard;
  authQuery: typeof authQuery;
  catchupConfig: typeof catchupConfig;
  catchupLogic: typeof catchupLogic;
  catchups: typeof catchups;
  clickup: typeof clickup;
  clickupConfig: typeof clickupConfig;
  clickupMutations: typeof clickupMutations;
  clickupOAuth: typeof clickupOAuth;
  clickupOAuthConfig: typeof clickupOAuthConfig;
  clickupOAuthNode: typeof clickupOAuthNode;
  correos: typeof correos;
  events: typeof events;
  http: typeof http;
  seed: typeof seed;
  settings: typeof settings;
  songs: typeof songs;
  subtasks: typeof subtasks;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
