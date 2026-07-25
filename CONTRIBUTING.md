# Contributing to Pi Pocket Console

Thank you for your interest! Pi Pocket Console is a small, focused project and every contribution helps.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to its terms.

## How to Contribute

### Reporting Bugs

Open an [issue](https://github.com/calvinbrady/pi-pocket-console/issues/new) with:

- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Pi Pocket Console version and Node.js version
- Terminal output from the gateway

### Suggesting Features

Open an [issue](https://github.com/calvinbrady/pi-pocket-console/issues/new) with:

- The problem you are solving (not just the solution)
- How the feature fits the project's scope (iPhone-first Pi remote control)
- Any relevant context or examples

### Submitting Pull Requests

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run the checks: `npm run check && npm test`
5. Commit with a clear message
6. Push and open a PR

**Before opening a PR:**

- Ensure all existing tests pass (`npm test`)
- Add tests for new functionality
- Run the linter (`npm run check`)
- Keep changes focused — one feature per PR
- Update documentation if needed

### Development Setup

```bash
git clone https://github.com/calvinbrady/pi-pocket-console.git
cd pi-pocket-console
npm ci
npm run check
npm test
```

### Project Structure

```
pi-pocket-console/
├── src/              # Gateway server (TypeScript)
│   ├── auth.ts       # Pairing, sessions, CSRF
│   ├── cli.ts        # CLI entry point
│   ├── controller-lease.ts  # Single-controller lease
│   ├── instance-manager.ts  # Pi RPC instance lifecycle
│   ├── normalize-model.ts   # Model normalization
│   ├── rpc-process.ts       # RPC child process
│   └── server.ts     # HTTP server and API
├── test/             # Tests (node:test)
├── public/           # PWA client assets
│   ├── index.html    # App shell
│   ├── app.css       # Styles (2249 lines)
│   ├── app.js        # Client logic (1607 lines)
│   └── sw.js         # Service worker
├── docs/             # Architecture and design docs
└── package.json
```

### Style Guide

- TypeScript strict mode, ES2022 target
- Biome for formatting (tab indentation, 120 column width)
- No semicolons in Biome config (Biome inserts them)
- Prefer `node:` protocol imports
- No third-party client-side libraries — vanilla JS only
- Security-sensitive code must have corresponding tests
