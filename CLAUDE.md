# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SQLMind Studio is a Windows-based SQL editor and database management tool built with Electron, Vue.js 2, and TypeScript. It supports Microsoft SQL Server and Azure SQL Database and offers both community (GPLv3) and paid editions.

## Architecture

### Monorepo Structure
- **`apps/studio/`** - Main Electron desktop application (`sqlmind-studio`)
- **`apps/ui-kit/`** - Reusable UI components library (`@sqlmindstudio/ui-kit`) + example apps
- **`apps/sqltools/`** - Web app workspace (built/served via root scripts `sqltools:dev` / `sqltools:build`)

### Technology Stack
- **Frontend (Renderer)**: Vue.js 2.7 + TypeScript, Vuex for state management
- **Desktop Shell**: Electron 31.7.3
- **Build**
  - **Main/Preload/Utility**: ESBuild (`apps/studio/esbuild.mjs`) bundles Node/Electron entrypoints to `apps/studio/dist/`
  - **Renderer**: Vite (`apps/studio/vite.config.mjs`) builds UI to `apps/studio/dist/renderer`
  - **Packaging**: electron-builder (`apps/studio/electron-builder-config.js`)
- **Testing**
  - **Unit/CI**: Jest
  - **E2E**: Playwright (`apps/studio/playwright.config.ts`, `apps/studio/playwright.ci.config.ts`)
- **Styling**: Sass/SCSS

### Key Entry Points
(Community build entrypoints are under `apps/studio/src/entrypoints-community/`)
- **Main Process**: `apps/studio/src/entrypoints-community/main.ts` (Electron main)
- **Renderer Process**: `apps/studio/src/entrypoints-community/renderer.ts` + `apps/studio/index.html` (Vue renderer entry)
- **Preload Script**: `apps/studio/src/entrypoints-community/preload.ts`
- **Utility Process**: `apps/studio/src/entrypoints-community/utility.ts`

### Core Interfaces
- **ConnectionInterface** - Database connection screen
- **CoreInterface** - Main database interaction interface (when connected)

## Development Commands

**Package Manager**: This project uses Yarn (not npm).

### Root-level Commands (from project root)
```bash
# Development
yarn bks:dev              # Start development server (builds lib + starts electron)
yarn electron:serve       # Alias for bks:dev

# Building  
yarn bks:build            # Build complete app (lib + electron)
yarn electron:build       # Alias for bks:build
yarn lib:build            # Build UI kit library only
yarn lib:dev              # Start UI kit in development/watch mode

# Testing
yarn test:unit            # Unit tests with Jest
yarn test:integration     # Integration tests  
yarn test:e2e             # End-to-end tests with Playwright
yarn test:ci              # CI-specific test configuration
yarn test:codemirror      # CodeMirror-specific tests

# Linting
yarn all:lint             # Lint all workspaces
```

### Studio App Commands (from apps/studio/)
```bash
# Development
yarn electron:serve       # Start development with hot reload
yarn dev:esbuild          # Watch main process (ESBuild)
yarn dev:vite             # Watch renderer process (Vite)

# Building
yarn build                # Build both main and renderer processes
yarn build:esbuild        # Build main process only
yarn build:vite           # Build renderer process only  
yarn electron:build       # Full production build with electron-builder

# Test Build (Agents - use this to test the build, also good for CI)
yarn run electron:build --linux AppImage  # Create Linux AppImage for testing

# Testing
yarn test:unit            # Unit tests
yarn test:integration     # Integration tests
yarn test:e2e             # E2E tests
yarn lint                 # ESLint
```

## Code Architecture

### Source Structure (apps/studio/src/)
```
components/          # Vue components organized by feature
├── common/         # Shared/reusable components
├── connection/     # Database connection forms
├── editor/         # Query editor components  
├── export/         # Data export functionality
├── sidebar/        # Sidebar navigation components
└── ...

lib/                # Core business logic
├── db/            # Database clients and connection logic
├── editor/        # Text editor functionality (CodeMirror)
├── export/        # Data export functionality
├── cloud/         # Cloud/workspace features
└── ...

background/         # Electron main process code
common/            # Shared utilities and models  
store/             # Vuex store modules
migration/         # Database migration scripts
assets/            # Styles, fonts, images
```

### Database Client Architecture
- Supports Microsoft SQL Server and Azure SQL Database types through unified client interface
- Database-specific clients in `src/lib/db/`
- Connection pooling and SSH tunneling support
- TypeORM used for app's internal SQLite database

### Plugin System
- Extensible architecture for third-party plugins
- Plugin manager with install/update capabilities
- Plugin code in `src/services/plugin/`

## Key Configuration Files

- **ESBuild**: `apps/studio/esbuild.mjs` (main process build)
- **Vite**: `apps/studio/vite.config.mjs` (renderer process build)  
- **TypeScript**: `apps/studio/tsconfig.json`
- **Jest**: `apps/studio/jest.config.js` (plus specialized configs)
- **Electron Builder**: `apps/studio/electron-builder-config.js`

## Running Tests

Always run tests from the appropriate directory:
- From root: `yarn test:unit`, `yarn test:integration`, `yarn test:e2e`
- From apps/studio: `yarn test:unit`, `yarn test:integration`, `yarn test:e2e`

Test files are organized in `apps/studio/tests/`:
- `unit/` - Unit tests
- `integration/` - Integration tests  
- `e2e/` - End-to-end tests with Playwright

## Development Workflow

1. **Setup**: `yarn install` from root
2. **Start development**: `yarn bks:dev` (from root) or `yarn electron:serve` (from apps/studio)
3. **Run tests**: `yarn test:unit` before committing
4. **Build**: `yarn bks:build` for production build

## Path Aliases (Vite/TypeScript)

```typescript
"@" -> "./src"
"@shared" -> "./src/shared"
"assets" -> "./src/assets"
"@bksLogger" -> "./src/lib/log/rendererLogger"
```

## License Model

The SQLMind Studio codebase is licensed under the GNU General Public License v3 (GPLv3),
except for specific components such as the UI Kit, which are licensed under the
GNU Affero General Public License v3 (AGPLv3).

Commercial plans and subscriptions relate to access to features, services, AI-assisted
functionality, or usage limits, and do not change the underlying open-source licenses.

## Database Support

SQLMind Studio is focused exclusively on Microsoft SQL Server and Azure SQL Database.

All database connection logic, query execution, and performance analysis are designed
specifically for T-SQL workloads and SQL Server–specific features.
