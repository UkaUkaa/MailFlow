# Adding a backend module

1. Create `backend/app/modules/<name>/` with `domain`, `application`, `infrastructure`,
   `presentation` (files or packages) and a `README.md`.
2. **Domain**: entities and rules, standard library only.
3. **Application**: use-case classes and the `Protocol` ports they need. Depend on other modules
   only through their `application` / `domain`.
4. **Infrastructure**: ORM models (import `Base` from `app.core.database.base`), repositories that
   take `user_id` for tenant data.
5. Register models in `app/core/database/registry.py`.
6. For a tenant table: add `user_id`, the composite FK to `email_accounts (id, user_id)` when it
   belongs to a mailbox, add the table to `TENANT_TABLES`, and in the migration enable RLS, create
   the `tenant_isolation` policy and grant privileges to the application role.
7. Wire the use cases in `app/bootstrap.py` (`Services`).
8. **Presentation**: router using `Auth` and `Svc` from `app.api.deps`; Pydantic schemas with
   `extra="forbid"`; no logic beyond mapping.
9. Include the router in `app/main.py`.
10. Tests: use-case/integration tests, a cross-tenant test, and run `tests/architecture`.
11. Docs: `docs/architecture/BACKEND_MODULES.md`, `docs/API.md`, `docs/DATABASE.md`.
