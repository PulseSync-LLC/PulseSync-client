# AGENTS.md

## Why this file exists
- This file helps an agent or developer navigate the repository quickly and avoid scattered or chaotic changes.
- The main goal is to make minimal, clear, and architecture-safe changes without breaking the boundaries between Electron main, preload, and renderer.
- If a task is local, change only the part of the project that actually owns that behavior.

## Project summary
- PulseSync is a desktop application built with Electron Forge, Vite, React, and TypeScript.
- The package manager is Yarn. The repository uses `nodeLinker: node-modules`.
- Build and packaging are already configured through `forge.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, and scripts in `scripts/`.
- The renderer is a React app, while the main process handles Electron logic, windows, system integrations, native modules, deeplinks, and background behavior.

## Core working principles
- Make focused changes and do not reorganize the project unless clearly necessary.
- First find the existing pattern, then extend it. Do not invent a new organizational style if the project already has a similar implementation.
- Preserve separation of responsibilities between application layers.
- Do not change architecture, UI, types, and build logic all at once unless the task truly requires it.
- If a problem can be solved inside an existing module, do not add a new abstraction layer “for the future”.

## Project map

### `src/main`
- This is the Electron main process.
- It includes:
  - window creation,
  - system events,
  - deeplink handling,
  - tray behavior,
  - updater logic,
  - main-process storage,
  - native module integrations,
  - internal HTTP/server modules,
  - logging and telemetry.
- If a task involves application windows, Electron lifecycle, filesystem access, platform APIs, or auto-update behavior, this is probably where the change belongs.

### `src/main/mainWindowPreload.ts` and the preload layer
- Preload is the bridge between the safe renderer and Electron/Node capabilities.
- If the renderer needs access to main-process or Node capabilities, first check whether preload already exposes a suitable API.
- Do not import Node or Electron APIs directly into the renderer unless the current architecture explicitly supports it.
- For new capabilities, first define the contract: what the renderer needs and what is safe to expose through preload and main.

### `src/renderer`
- This is the React UI layer.
- The structure is already split into:
  - `app` — application bootstrap, providers, root setup, routing;
  - `pages` — full pages;
  - `widgets` — larger composed UI blocks;
  - `features` — user actions and interactive workflows;
  - `entities` — domain entities and related logic;
  - `shared` — reusable UI, API, utilities, and infrastructure pieces.
- Add new logic to the closest matching layer instead of creating random new folders.

### `src/common`
- Shared types, shared config, and data that may be used in multiple parts of the application.
- If a type is needed in both main and renderer, check here first.
- Do not put everything here by default: if a type or function is only used in one area, keep it close to that area.

### `src/locales`
- Application localizations.
- If you add new user-facing text, check whether nearby code already uses i18n and add keys consistently.
- Do not hardcode user-visible strings where translations are already in use.

### `static` and `icons`
- Static assets and icons.
- For renderer UI assets, first look in `static/assets` and existing imports.
- Do not duplicate images or icons if a suitable resource already exists.

### `nativeModules`
- Native modules and binary dependencies used by the build.
- Changes here must be made carefully because this area is tied to packaging and platform-specific behavior.

### `scripts`
- Helper scripts for build and publishing workflows.
- If a task involves packaging, publishing, release flow, or artifact preparation, inspect the existing scripts first instead of adding ad hoc shell commands around them.

## How to decide where a change belongs

### If the UI changes
- The work usually belongs in `src/renderer`.
- First determine the right level:
  - one page — `pages`,
  - a composed section of a page — `widgets`,
  - a focused user interaction — `features`,
  - domain-specific logic — `entities`,
  - universal component or helper — `shared`.

### If Electron behavior changes
- Look in `src/main`.
- Examples: windows, tray, deeplinks, auto-updates, filesystem access, local servers, system events, platform-specific logic.

### If renderer needs data or actions from main
- Do not pull Node or Electron code directly into a React component.
- Follow this path:
  - define the contract,
  - update shared types if needed,
  - add or adjust preload API,
  - handle the event or request in main,
  - only then use it in renderer.

### If shared types or process events change
- Check `src/common/types`.
- Keep IPC and cross-process contracts in one clear place.
- Do not create duplicate types for the same payload shape.

### If build or packaging behavior changes
- Check these first:
  - `package.json`,
  - `forge.config.ts`,
  - Vite configs,
  - `scripts/build.ts`,
  - related publish scripts.
- Do not patch runtime code to work around a problem that actually belongs in build configuration.

## Import and dependency rules
- Prefer the existing aliases from `tsconfig.json`:
  - `@common`
  - `@app`
  - `@pages`
  - `@widgets`
  - `@features`
  - `@entities`
  - `@shared`
  - `@` for static assets
- Avoid deep relative imports when an alias already exists.
- Do not add a new library if the task can be solved with the current stack.
- Before adding a dependency, check whether the project already uses something that covers the same need.

## Architecture rules
- Renderer must not directly depend on Node or Electron APIs.
- Main must not contain React or UI logic.
- Shared types and contracts should stay separate from concrete UI implementation.
- If logic is already structured as a module, extend that module instead of duplicating code nearby.
- Prefer simple functions and clear modules over deep abstraction without immediate value.

## Code style rules
- Follow the current Prettier configuration:
  - 4-space indentation,
  - single quotes,
  - no semicolons,
  - trailing commas enabled,
  - `printWidth` 150.
- Before “improving style”, check nearby code and match its shape.
- Do not rename files, variables, or concepts unless needed for the task.
- Do not make broad formatting-only edits in files that only need a small functional change.
- New types, interfaces, and names should reflect domain meaning, not accidental technical detail.

## Strings, i18n, and text
- If nearby code already uses localization, add translation keys instead of new hardcoded strings.
- Keep text style consistent with the file context: part of the project and documentation is written in Russian.
- For user-facing messages, prefer short, clear, neutral wording.

## What not to edit unless required
- Do not edit generated build or packaging artifacts:
  - `.vite/`
  - `out/`
  - `release/`
  - `node_modules/`
  - `tsconfig.node.tsbuildinfo`
- Do not touch `.env`, release config, publish settings, or sensitive parameters unless the task explicitly requires it.
- Do not update dependencies “while you are here” unless asked.
- Do not fix unrelated bugs on the side.

## Practical workflow before editing
- First identify the layer: `main`, `preload`, `renderer`, `common`, `scripts`, or `config`.
- Then find the closest existing implementation of similar behavior.
- Check whether matching types, helpers, components, or modules already exist.
- Only after that, make the minimal change.
- After the change, think about whether types, localization, imports, or build config also need to be updated.

## Practical workflow after editing
- Check that process boundaries are still respected.
- Check for duplicated types, strings, or helpers.
- Check that generated artifacts or unrelated files were not changed by accident.
- If the change affects build, preload, or cross-process contracts, verify every touched side.

## Validation
- There is no obvious dedicated root-level test suite here, so default validation relies on project and static-check commands.
- Main commands:
  - `yarn typecheck`
  - `yarn lint`
  - `yarn format`
  - `yarn start`
- For packaging-related tasks:
  - `yarn build:package`
  - `yarn build:installer`
  - `yarn build:nativeModules`
- If the change is local, prefer the smallest relevant validation first instead of always running a large full-project workflow.

## Commits and history
- If you need to suggest a commit message, use Conventional Commits.
- Do not mix unrelated changes in one edit or one commit.
- If the task is only about documentation or repository metadata, do not bundle unrelated code changes into it.

## Areas that require extra caution
- Changes in `forge.config.ts`
- Changes in preload
- Changes to IPC contracts and cross-process types
- Changes in `nativeModules`
- Changes in publish or build scripts
- Changes in localization keys that may already be used in several places

## Useful reference points
- `package.json` — commands, dependencies, and build scripts
- `tsconfig.json` and child tsconfig files — aliases and TypeScript build rules
- `forge.config.ts` — Electron Forge packaging
- `vite.main.config.ts` — main process build
- `vite.preload.config.ts` — preload build
- `vite.renderer.config.ts` — renderer build
- `graphql.config.yml` and `schema.graphql` — GraphQL tooling
- `CONTRIBUTING.md` — contribution guidance and Conventional Commits

## Expected behavior from an agent
- Explain what is changing and why it belongs in that location.
- Avoid unnecessary refactors.
- Do not introduce new concepts without reason.
- Preserve the current project structure.
- Leave the codebase easier to understand, not just technically working.
