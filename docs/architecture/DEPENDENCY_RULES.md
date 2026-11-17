# Dependency rules

1. Dependencies point inward: presentation → application → domain. Infrastructure depends on
   application/domain and implements their ports.
2. Ports are `typing.Protocol` classes declared next to the use case that needs them.
3. Use cases receive every collaborator through `__init__`. No service locators, no module-level
   singletons other than the settings object and the engine.
4. Wiring is done in composition roots only (see `MODULE_BOUNDARIES.md`).
5. `app.core` never imports `app.modules`.
6. `app.shared` never imports `app.core` or `app.modules`.
7. `app.integrations.email_providers.*` never imports `app.modules`.
8. A module graph cycle is a build failure (architecture test).
9. Third-party libraries are added only when they remove real work and are actively maintained;
   record anything non-obvious in `docs/DECISIONS.md`.

## Frontend

1. `src/shared` never imports from `src/modules`.
2. `src/infrastructure` never imports from `src/modules`.
3. A feature module imports another feature only through its `index.ts`.
4. Route files in `src/app` compose feature components; they contain no data logic.
5. Only `src/infrastructure/api-client` calls `fetch`.
