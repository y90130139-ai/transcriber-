// Lets `node --test` run the app's extensionless TypeScript imports
// (`./metrics` → `./metrics.ts`) the way the Next bundler resolves them.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw error
    }
  },
})
