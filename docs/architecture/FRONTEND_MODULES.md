# Frontend modules

```
frontend/src/
  app/[locale]/
    (auth)/            login, register, verify-email, forgot-password, reset-password
    (application)/     mail/[view], mail/[view]/[threadId], search, settings/*
  modules/
    authentication/    forms, session hook, auth API
    accounts/          connected accounts list, connect flow, account switcher
    inbox/             thread list, list row, list toolbar, unified/individual filtering
    emails/            reader, thread view, message card, EmailFrame, message actions
    composer/          composer state, editor, recipients input, draft autosave, send
    attachments/       attachment chips, download
    folders/           folder navigation, counts
    search/            search box, results
    settings/          profile, appearance, language, sessions, danger zone
  shared/
    components/ui/         buttons, inputs, dialog, sheet, dropdown, toast ...
    components/layout/     AppShell, Pane, ResponsiveDialog, ResponsiveMenu
    components/feedback/   EmptyState, ErrorState, Skeleton, Spinner
    hooks/ lib/ types/ constants/ utils/
  infrastructure/
    api-client/        fetch wrapper, CSRF, error mapping, query client
    authentication/    session provider, route guard
    i18n/              next-intl routing, request config, navigation helpers
    theme/             theme provider
  messages/            en.json, uk.json
```

Each feature owns its components, hooks, API functions, Zod schemas, types and tests, and exposes
a small `index.ts`. Route files only compose feature components.

## Data flow

- Server state: TanStack Query. Query keys are defined per module in `api/keys.ts`.
- Mutations are optimistic for message actions (read, star, archive, trash) with rollback.
- Client state: React context for composer and shell (drawer open, sidebar collapsed). Persisted
  UI preferences (sidebar width/collapse) use `localStorage`; nothing sensitive is stored there.
- Authentication: HttpOnly session cookie. The client reads only the non-secret CSRF cookie and
  echoes it in `X-CSRF-Token`. A 401 from any call clears the query cache and redirects to login.

## Routing

`/[locale]/mail/[view]` where `view` is `inbox | starred | sent | drafts | archive | trash | spam`
or `folder-{id}`; `?account={id}` narrows to one account (absent = unified).
`/[locale]/mail/[view]/[threadId]` opens a conversation.
