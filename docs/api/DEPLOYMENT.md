# API Documentation Deployment

## Overview

The scoopdope API documentation can be deployed to GitHub Pages for public access.

## Setup Instructions

### 1. Enable GitHub Pages

1. Go to repository Settings → Pages
2. Source: "GitHub Actions"
3. Save

### 2. Create GitHub Actions Workflow

Due to OAuth token scope limitations, the workflow file must be created manually via GitHub UI or with a token that has `workflow` scope.

Create `.github/workflows/deploy-api-docs.yml`:

```yaml
name: Deploy API Documentation

on:
  push:
    branches:
      - main
    paths:
      - 'apps/backend/src/**'
      - 'docs/api/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build backend and export OpenAPI spec
        working-directory: apps/backend
        run: |
          npm run build
          npm run export:openapi
          mkdir -p ../../docs/api/dist
          cp dist/openapi.json ../../docs/api/dist/openapi.json

      - name: Copy Swagger UI
        run: cp docs/api/swagger-ui.html docs/api/dist/index.html

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'docs/api/dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 3. Manual Deployment (Alternative)

If automated deployment isn't set up yet:

```bash
# Build backend and export OpenAPI spec
cd apps/backend
npm run build
npm run export:openapi

# Copy files to docs/api/dist
mkdir -p ../../docs/api/dist
cp dist/openapi.json ../../docs/api/dist/
cp ../api/swagger-ui.html ../../docs/api/dist/index.html

# Deploy to GitHub Pages (manual)
# Upload docs/api/dist contents to gh-pages branch
```

## Accessing Documentation

Once deployed, the API documentation will be available at:
- **Production (static export)**: https://nonso-eze.github.io/scoopdope/
- **Local**: http://localhost:3000/api/docs

## Production Swagger Access Policy

The live Swagger UI served by the backend at `/api/docs` is **disabled by default in production** to prevent unauthenticated reconnaissance of the API surface.

### Behavior by environment

| Environment | `NODE_ENV` | Swagger at `/api/docs` |
| --- | --- | --- |
| Local | `development` (or unset) | Served normally, no auth |
| Staging | `staging` | Served normally, no auth |
| Production | `production` | Returns `404` unless explicitly enabled |

### Enabling Swagger in production

Swagger can be re-enabled in production by setting `SWAGGER_ENABLED=true`. When enabled in production, the docs are protected by **HTTP Basic Auth**:

- Username: `admin`
- Password: the value of the `SWAGGER_PASSWORD` environment variable

If `SWAGGER_ENABLED=true` is set in production without a `SWAGGER_PASSWORD`, the docs remain disabled (fail closed).

### Configuration

Add the following to your environment (see `.env.example`):

```bash
# Set to "true" to enable Swagger UI in production (protected by Basic Auth)
SWAGGER_ENABLED=false

# Password for HTTP Basic Auth on /api/docs when enabled in production
SWAGGER_PASSWORD=
```

### GitHub Pages

The static documentation export deployed to GitHub Pages is generated at build time and is **unaffected** by the runtime Swagger guard. The workflow above continues to export the OpenAPI spec and publish it independently of `SWAGGER_ENABLED` / `SWAGGER_PASSWORD`.

## Updating Documentation

Documentation updates automatically when:
- Backend source code changes are pushed to main
- Swagger decorators are updated in controllers
- DTOs are modified

The workflow rebuilds and redeploys the OpenAPI spec on every relevant push.
