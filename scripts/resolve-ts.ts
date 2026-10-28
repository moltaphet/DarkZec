import { registerHooks } from 'node:module';

/**
 * The browser sources import each other without extensions, as Vite allows. Scripts that reuse them
 * (settlement, chain verification) run under Node's own TypeScript support, which needs the `.ts`.
 *   node --import ./scripts/resolve-ts.ts scripts/<script>.ts
 */
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error: unknown) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});
