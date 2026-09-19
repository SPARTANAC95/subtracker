# Contributing

Thanks for taking the time to contribute.

## Development setup

```bash
npm install
npm run dev
```

The Vite dev server runs on `http://127.0.0.1:5280` and proxies API calls to
the local data server on `http://127.0.0.1:5273` when it is running.

To run the real local app experience:

```bash
npm run app
```

## Checks

```bash
npm test
npm run lint
npm run build
npm run check
```

## Pull requests

Please keep PRs focused. If you change behavior, include a short explanation of
what changed and why. If you fix a bug, add or update tests when practical.

## Issues

When filing a bug, include:

- what you expected
- what happened instead
- reproduction steps
- screenshots if the bug is visual
- browser / OS / Node version if relevant
