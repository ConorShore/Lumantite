# Lumantite

Web-based optical network planner: power budgets, chromatic dispersion and wavelength-aware
routing through mux/demux and amplifiers. Networks are edited on a schematic canvas and stored
as YAML; every device comes from an editable catalog.

- Specification: [SPEC.md](SPEC.md)
- Package contract: [docs/CONTRACT.md](docs/CONTRACT.md)

## Layout

```
packages/schema   zod schemas and shared types
packages/engine   physics, propagation, checks, exports (pure)
packages/project  comment-preserving YAML sessions for projects and catalog
packages/catalog  starter catalog and example projects
apps/server       Fastify file API + static hosting
apps/cli          lumantite check | export
apps/web          React SPA
docker/           Dockerfile and docker-compose.yaml
```

## Develop

```bash
npm install
npm run build
npm test
npm run dev          # web app on http://localhost:5173, proxies /api to :8080
npm run start        # server (after build)
```

## Run with Docker

```bash
cp config.example.yaml config.yaml
docker compose -f docker/docker-compose.yaml up --build
```

## License and disclaimer

Lumantite is released under the [Apache License 2.0](LICENSE). It is a planning aid only:
its calculations and exports may be wrong and are provided without warranty. The author
accepts no liability for decisions made on the basis of its output. Read
[DISCLAIMER.md](DISCLAIMER.md) before relying on any result.
