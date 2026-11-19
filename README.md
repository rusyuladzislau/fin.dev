# fin.dev tech task

**Market simulator** — a realtime simulated-market dashboard built with Angular 21, strict TypeScript, Tailwind CSS 4, Rust, WebAssembly, and a Web Worker. It generates synthetic order-book and trade updates entirely in the browser and aggregates cumulative instrument metrics without retaining trade history.

## Features

- Dashboard with last traded price, bid–ask spread, cumulative volume, VWAP, and order-book imbalance for every configured instrument.
- Pause/Resume without losing accumulated metrics or generating catch-up batches.
- Settings for 1–50 instruments, 1–1,000 updates per batch, and a 50–2,000 ms batch interval.
- Validated reactive form; draft edits do not affect the active producer until Apply.
- A clean producer run on every Apply, including termination of the previous Worker.
- Root-level state that survives navigation between Dashboard and Settings.
- Responsive dark UI, keyboard focus states, and horizontal scrolling inside the table on narrow screens.
- Visible initialization/runtime errors with a Retry action.

## Architecture

```text
Angular 21 + Tailwind CSS 4
        │ commands and throttled snapshots
        ▼
Root-level ProducerService (signals, runId, lifecycle)
        │ postMessage
        ▼
Web Worker (scheduling + metric aggregation)
        │ generateBatch(...)
        ▼
Rust + wasm-bindgen (stateful market generator)
```

### Runtime responsibilities

- **Angular** owns routing, presentation, formatting, form validation, and user commands.
- **ProducerService** owns the single Worker, active settings, signals, run identity, errors, and cleanup.
- **The Worker** owns non-overlapping `setTimeout` scheduling, processes every generated update, and sends UI snapshots at most once every 100 ms.
- **Rust/Wasm** owns deterministic pseudo-randomness, per-instrument price state, and market-update generation.

### Feature-Sliced Design

The frontend follows Feature-Sliced Design (FSD), using the same top-level layer model as the referenced Angular example. Dependencies point downward only:

```text
app → pages → features → entities → shared
```

- **`app`** is the composition root: application configuration, lazy routes, shell, and navigation.
- **`pages`** contains route-level screen composition. Pages do not own Worker scheduling or form-control implementation details.
- **`features/producer`** contains complete user actions: pausing/resuming/retrying a producer and applying a validated settings draft.
- **`entities/producer`** contains producer settings, the root-level signal store, Worker lifecycle, and the Worker API/protocol.
- **`entities/instrument`** owns market-update types and incremental metric calculations independently of Angular.
- **`shared/ui`** contains business-agnostic reusable UI such as the status badge.

Each slice exposes a public `index.ts` entry point. Cross-layer imports use that public API instead of depending on another slice's internal layout. The Worker remains under `entities/producer`, not `shared`, because scheduling and aggregation are domain-specific behavior.

The optional **`widgets`** layer is intentionally omitted: this small application has no independently reused composite widget that would justify another layer. FSD layers are added when they clarify ownership, not as empty ceremonial folders. The trade-off is more files and public-entry-point indirection; in return, route composition, user actions, domain state, and generic UI can evolve and be tested independently.

### Data invariants

- Prices are generated and transported as integer cents; floating-point conversion happens only for display.
- A trade executes at either the current bid or ask, and bid is always strictly below ask.
- Volume and VWAP include every trade exactly once, independently of UI snapshot frequency.
- VWAP is cumulative traded value divided by cumulative quantity, not a rolling-window average.
- Imbalance is `(bidQuantity - askQuantity) / (bidQuantity + askQuantity)`; unavailable values render as `—`.
- The complete update/trade history is never stored.
- Each run has a `runId`; messages from replaced Workers cannot overwrite current state.
- Pause cancels the schedule. Resume continues the same state and does not backfill the paused interval.

## Project structure

```text
src/app/                             Composition root, lazy routes, and application shell
src/pages/dashboard/                 Dashboard route composition
src/pages/dashboard/components/      Route-specific instrument metrics table
src/pages/settings/                  Settings route composition and active-run summary
src/features/producer/toggle-producer/
src/features/producer/apply-settings/
src/entities/producer/api/           Worker implementation and typed message protocol
src/entities/producer/model/         Settings, validation, signals, and lifecycle tests
src/entities/instrument/model/       Market types, metric aggregation, and unit tests
src/shared/ui/button/                Shared primary and secondary buttons
src/shared/ui/number-field/          Reusable validated numeric form field
src/shared/ui/status-badge/          Reusable business-agnostic status UI
src/shared/ui/svg-icon/              Shared SVG sprite icon renderer
crates/market-generator/             Rust generator and Rust unit tests
public/icons/sprite.svg              Project-owned SVG symbols; no icon package required
public/wasm/                         Generated wasm-bindgen artifacts (not committed)
public/_redirects                    Cloudflare Pages SPA fallback
scripts/build-cloudflare.sh          Pages toolchain setup and production build
.github/workflows/ci.yml             Frontend/Rust tests and production build
```

## Prerequisites

Verified locally with:

- Node.js `24.22.1` and npm `11.12.1` (`.nvmrc` pins the Node.js version).
- Rust `1.100.0` with `rustup`.
- `wasm-pack` `0.15.1`.
- The `wasm32-unknown-unknown` Rust target.

Install the Rust toolchain components:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.1 --locked
```

## Install and run locally

```bash
npm ci
npm run build:wasm
npm run dev
```

Open `http://localhost:4200/`. The development script forwards Angular CLI arguments, for example:

```bash
npm run dev -- --host 0.0.0.0 --port 7100
```

`npm run dev` does not implicitly rebuild Wasm. Run `npm run build:wasm` after changing Rust code or after a clean checkout.

## Tests and checks

```bash
# Angular, TypeScript, templates, and FSD architectural boundaries
npm run lint

# Apply safe ESLint fixes
npm run lint:fix

# Angular/TypeScript unit tests
npm test

# Rust generator tests
npm run test:wasm

# Both test suites
npm run test:all

# Strict TypeScript check
npx tsc --noEmit -p tsconfig.app.json
```

The current suite contains 28 Angular/TypeScript tests and 7 Rust tests. Browser verification also covers Pause/Resume, Apply, navigation, validation, narrow layouts, and the maximum nominal mode of 50 instruments and 20,000 updates/second.

### Manual retry verification

1. Open Chrome DevTools → **Network** and enable **Disable cache**.
2. Open **Network request blocking**, enable it, and add this URLPattern:

   ```text
   *://*:*/wasm/market_generator_bg.wasm
   ```

3. Reload the page with DevTools open. The dashboard should retry initialization five times, then show an error and **Retry producer**.
4. Disable request blocking and click **Retry producer**. The application should recover without another reload.

## Production build

```bash
npm run build
```

This command builds the Rust crate with `wasm-pack`, then builds optimized Angular assets. Deployable files are written to:

```text
dist/app/browser
```

The generated Wasm files are intentionally ignored by Git. Both CI and Cloudflare Pages regenerate them from the Rust source.

## Continuous integration

The GitHub Actions workflow runs on pushes to `main`, pull requests, and manual dispatch. It:

1. Installs the pinned Node.js version and JavaScript dependencies.
2. Installs stable Rust, the Wasm target, and `wasm-pack` `0.15.1`.
3. Lints Angular, TypeScript, HTML templates, and FSD dependency boundaries.
4. Runs Angular/TypeScript and Rust tests.
5. Runs the strict TypeScript check.
6. Builds Wasm and the production Angular application.

## Cloudflare Pages deployment

Connect the GitHub repository to Cloudflare Pages and use:

| Setting                | Value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Root directory         | Leave empty when `package.json` is at the repository root; use `app` when connecting the parent workspace |
| Build command          | `bash scripts/build-cloudflare.sh`                                                                        |
| Build output directory | `dist/app/browser`                                                                                        |
| Node.js version        | Read automatically from `.nvmrc`                                                                          |

The Pages script installs Rust and the pinned `wasm-pack` version when they are unavailable, adds the Wasm target, and runs `npm run build`. Cloudflare Pages installs JavaScript dependencies before running the build command.

Production deployments update automatically after a push to the configured production branch. `public/_redirects` contains `/* /index.html 200`, so direct navigation to `/dashboard` and `/settings` uses the Angular application rather than returning a hosting 404.

After the first deployment, verify `/`, `/dashboard`, `/settings`, and these generated assets:

```text
/wasm/market_generator.js
/wasm/market_generator_bg.wasm
```

## Vercel deployment

`vercel.json` configures the Vercel build, Node.js 24 through `package.json`, the Angular output directory, and the SPA fallback for direct route navigation. Vercel runs `scripts/build-with-wasm.sh`, which installs the Rust/Wasm toolchain when necessary and creates the production build.

Import the GitHub repository into Vercel, or use the CLI from the repository root:

```bash
npx vercel login
npx vercel link
npx vercel --prod
```

Subsequent pushes to the connected production branch can trigger automatic deployments through Vercel's Git integration.

## Trade-offs and limitations

- The generator is deterministic and seedable for reproducible tests; it is not a real market-data feed or a market microstructure model.
- Rust/Wasm keeps generation and state evolution isolated from Angular, but introduces a Rust/Wasm build toolchain.
- Metric aggregation runs in the Worker so high-frequency updates do not block UI input or Angular rendering.
- Snapshot throttling reduces rendering work without sampling away trades: aggregation still processes every update.
- Non-overlapping timers avoid concurrent batches; requested cadence is nominal rather than a guaranteed realtime deadline.
- State is in memory only. Reloading the page resets settings and metrics.
- There is no backend, persistence, authentication, or external market-data dependency.
- Browser checks are smoke/performance checks, not a formal latency or throughput benchmark.
