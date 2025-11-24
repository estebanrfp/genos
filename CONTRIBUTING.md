# Contributing to GenosOS

Thanks for your interest in contributing to GenosOS! This project runs on Bun with pure JavaScript (ES2024+).

## Getting started

```bash
git clone https://github.com/estebanrfp/GenosOS
cd GenosOS
pnpm install
bun run test
```

## Development guidelines

- **Runtime:** Bun >= 1.2 (not Node.js)
- **Language:** Pure JavaScript ES2024+ — no TypeScript
- **Package manager:** pnpm (not npm or yarn)
- **Style:** Arrow functions, async/await, optional chaining, nullish coalescing
- **No classes:** Prefer factory functions, composition, and pure functions
- **Testing:** Vitest — run with `bun run test`

## Code standards

- All code, comments, logs, and documentation in English
- JSDoc for public functions
- Clear, semantic, descriptive naming — no cryptic abbreviations
- Optimize: minimal lines, early returns, array methods over loops

## Pull requests

1. Fork the repo and create a feature branch
2. Make your changes with clear, concise commits
3. Ensure all tests pass: `bun run test`
4. Submit a PR with a description of what changed and why

## Security

If you discover a security vulnerability, please report it responsibly. See [SECURITY.md](SECURITY.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Author

Esteban Fuster Pozzi (@estebanrfp) — Full Stack JavaScript Developer
