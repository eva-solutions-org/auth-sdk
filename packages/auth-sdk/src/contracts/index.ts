/**
 * Public entry `@eva_solutions/auth-sdk/contracts`: the shared wire contract (schemas, constants
 * and route descriptors) of the Auth API.
 *
 * The contract package is private and never published: the build inlines it into this entry
 * (`deps.alwaysBundle`), so consumers install this SDK only. Consumers must resolve `zod` to a
 * single copy (the contract schemas and the consumer's own schemas must share one zod instance).
 */
export * from '@eva_solutions/auth-contracts'
