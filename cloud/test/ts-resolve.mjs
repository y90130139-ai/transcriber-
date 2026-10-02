// Lets `node --test` run the app's extensionless TypeScript imports
// (`./metrics` → `./metrics.ts`) the way the Next bundler resolves them.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    // The bundler imports JSON bare (lib/taxonomy.ts); Node wants the attribute.
    if (specifier.endsWith('.json')) {
      const resolved = next(specifier, context)
      return { ...resolved, importAttributes: { type: 'json' } }
    }
    try {
      return next(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw error
    }
  },
})
