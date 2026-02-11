```bash
go run apps/telemetry/grpc-parser/cmd/server/main.go

go run apps/telemetry/agent-to-grpc/main.go

cd apps/core && bun dev

cd apps/web && pnpm dev

```

## Telemetry

MQTT Entry:
Topic: device/uuidv7/telemetry/v1

HTTP Post Entry:
URL: http://localhost/api/telemetry/v1

GRPC Client:
.proto:
message Telemetry {
string version = 1;
string deviceid = 2;
string payload = 3;
}

GRPC Server:

MQTT/HTTP Entry Points (thin clients)
↓ (forward raw data + deviceId)
gRPC Server (core logic)
↓

1. Authenticate/validate deviceId
2. Fetch device-specific parsing rules (by deviceModel)
3. Parse according to device config
4. Write to Redis streams

Detailing:

1. MQTT/HTTP receives data
   - Minimal validation (is it valid JSON/binary?)
   - Extract deviceId
2. Send to gRPC server:
   - deviceId
   - raw payload
   - metadata (timestamp, source)

3. gRPC server:
   - Authenticate: "Does this deviceId exist and is it active?"
   - Authorize: "Is this organization allowed to write?"
   - Fetch parsing config for this deviceId
     ===> Get Struct from protobuf and scale offset from redis
   - Parse/decode according to device-specific rules
   - Write to Redis (potentially to org-specific streams)

REDIS:

```bash
# Store device info in Redis
redis-cli SET "device:abc123" '{
  "is_active": true,
  "is_authorized": true,
  "org_id": "org_xyz",
  "parse_config": {
    "type": "json",
    "schema": {}
  }
}'
```

```go
// AspectMidia
case "am19_sl": smartlight
case "am19_pc": counter
case "am19_mf": milkfat
case "am19_ed": energymeter
case "am19_gps": gps
case "am19_gp": gaugepressure
case "am19_hyd": hydrometer
case "am19_sm3dl": soilmoisture3depthlevels
case "am19_t8p": temperature8Point
case "am19_va": vibrationAverage
case "am19_udl": waterTankLevel

// Milesight
case "am103":
case "ds3604":
case "ws101":
case "ws101_r":
case "ws156":
case "ws202":
case "ws301":
case "ws302":
case "ws501_w12_us":
case "ws513_eu":
case "ws523_eu":
case "ws558_ln":
case "ws558_switch":
case "wt201_hvac":
case "em300_th":
case "em300_di":
case "em300_mcs":
case "em300_sld":
case "ct101":
case "ct303":
case "em320_th":
case "em400_tld":
case "em400_mud":
case "em400_udl_c100":
case "em410_rdl":
case "em500_swl_l005":
case "em500_swl_l010":
case "uc100_rs485":
case "at101":
case "uc300":
case "uc501":
case "uc511":
case "ex_301":


// Khomp
case "nit_2xli":
case "nit_21lv": ems-104 WeatherStation
case "dtl500":
case "dtl200_l005":
case "dtl200_ad":

// SagaMedicao
case "hid_ss":

// Kron
case "ks3000_wifi":
case "ks3000_lora":

```

server:

```bash
go run apps/telemetry/grpc-parser/main.go
```

clients:

```bash
go run apps/telemetry/mqtt-to-grpc/main.go
```

```bash
go run apps/telemetry/post-to-grpc/main.go
```

.proto:

```bash
protoc \
  --proto_path=packages/proto \
  --go_out=packages/proto/gen/go \
  --go-grpc_out=packages/proto/gen/go \
  --go_opt=paths=source_relative \
  --go-grpc_opt=paths=source_relative \
  telemetry/v1/telemetry.proto
```

## devices

019b08df-26e7-7506-a5f6-916b2bef24f4 -> ks3000 -> 2491028 - Bloco V
019b08df-26e7-71b5-8df6-56c2e954ac91 -> ks3000 -> 2515111 - Bloco N
019b08df-26e7-7119-97da-523f9236db80 -> ks3000 -> 2515112 - Ginásio
019b08df-26e7-7f7b-a18f-b3d6c3fdf248 -> ks3000 -> 2515113 - Quiosque
019b08df-26e7-7866-a0fb-1768122b8584 -> ks3000 -> 2515114 - Acai

MQTT Topics:
device/UUIDV7/telemetry
device/UUIDV7/event
device/UUIDV7/command

## ks3000

### instant

```json
[
  {
    "variable": "data",
    "time": "2025-12-19 14:24:20",
    "metadata": {
      "U0": 226.75,
      "I0": 1.42,
      "F1": 59.95,
      "P0": 307.09,
      "Q0": -463.7,
      "FP0": 0.55,
      "EA": 1259.22,
      "ER": 145.61,
      "EAN": -158.5,
      "ERN": -1113.25,
      "CE": 0
    }
  }
]
```

# Turborepo Design System Starter

This is a community-maintained example. If you experience a problem, please submit a pull request with a fix. GitHub Issues will be closed.

This guide explains how to use a React design system starter powered by:

- 🏎 [Turborepo](https://turborepo.com) — High-performance build system for Monorepos
- 🚀 [React](https://reactjs.org/) — JavaScript library for user interfaces
- 🛠 [Tsup](https://github.com/egoist/tsup) — TypeScript bundler powered by esbuild
- 📖 [Storybook](https://storybook.js.org/) — UI component environment powered by Vite

As well as a few others tools preconfigured:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting
- [Changesets](https://github.com/changesets/changesets) for managing versioning and changelogs
- [GitHub Actions](https://github.com/changesets/action) for fully automated package publishing

## Using this example

Run the following command:

```sh
npx create-turbo@latest -e design-system
```

### Useful Commands

- `pnpm build` - Build all packages, including the Storybook site
- `pnpm dev` - Run all packages locally and preview with Storybook
- `pnpm lint` - Lint all packages
- `pnpm changeset` - Generate a changeset
- `pnpm clean` - Clean up all `node_modules` and `dist` folders (runs each package's clean script)

## Turborepo

[Turborepo](https://turborepo.com) is a high-performance build system for JavaScript and TypeScript codebases. It was designed after the workflows used by massive software engineering organizations to ship code at scale. Turborepo abstracts the complex configuration needed for monorepos and provides fast, incremental builds with zero-configuration remote caching.

Using Turborepo simplifies managing your design system monorepo, as you can have a single lint, build, test, and release process for all packages. [Learn more](https://vercel.com/blog/monorepos-are-changing-how-teams-build-software) about how monorepos improve your development workflow.

## Apps & Packages

This Turborepo includes the following packages and applications:

- `apps/docs`: Component documentation site with Storybook
- `packages/ui`: Core React components
- `packages/typescript-config`: Shared `tsconfig.json`s used throughout the Turborepo
- `packages/eslint-config`: ESLint preset

Each package and app is 100% [TypeScript](https://www.typescriptlang.org/). Workspaces enables us to "hoist" dependencies that are shared between packages to the root `package.json`. This means smaller `node_modules` folders and a better local dev experience. To install a dependency for the entire monorepo, use the `-w` workspaces flag with `pnpm add`.

This example sets up your `.gitignore` to exclude all generated files, other folders like `node_modules` used to store your dependencies.

### Compilation

To make the ui library code work across all browsers, we need to compile the raw TypeScript and React code to plain JavaScript. We can accomplish this with `tsup`, which uses `esbuild` to greatly improve performance.

Running `pnpm build` from the root of the Turborepo will run the `build` command defined in each package's `package.json` file. Turborepo runs each `build` in parallel and caches & hashes the output to speed up future builds.

For `@acme/ui`, the `build` command is equivalent to the following:

```bash
tsup src/*.tsx --format esm,cjs --dts --external react
```

`tsup` compiles all of the components in the design system individually, into both ES Modules and CommonJS formats as well as their TypeScript types. The `package.json` for `@acme/ui` then instructs the consumer to select the correct format:

```json:ui/package.json
{
  "name": "@acme/ui",
  "version": "0.0.0",
  "sideEffects": false,
  "exports":{
    "./button": {
      "types": "./src/button.tsx",
      "import": "./dist/button.mjs",
      "require": "./dist/button.js"
    }
  }
}
```

Run `pnpm build` to confirm compilation is working correctly. You should see a folder `ui/dist` which contains the compiled output.

```bash
ui
└── dist
    ├── button.d.ts  <-- Types
    ├── button.js    <-- CommonJS version
    ├── button.mjs   <-- ES Modules version
    └── button.d.mts   <-- ES Modules version with Types
```

## Components

Each file inside of `ui/src` is a component inside our design system. For example:

```tsx:ui/src/Button.tsx
import * as React from 'react';

export interface ButtonProps {
  children: React.ReactNode;
}

export function Button(props: ButtonProps) {
  return <button>{props.children}</button>;
}

Button.displayName = 'Button';
```

When adding a new file, ensure that its specifier is defined in `package.json` file:

```json:ui/package.json
{
  "name": "@acme/ui",
  "version": "0.0.0",
  "sideEffects": false,
  "exports":{
    "./button": {
      "types": "./src/button.tsx",
      "import": "./dist/button.mjs",
      "require": "./dist/button.js"
    }
    // Add new component exports here
  }
}
```

## Storybook

Storybook provides us with an interactive UI playground for our components. This allows us to preview our components in the browser and instantly see changes when developing locally. This example preconfigures Storybook to:

- Use Vite to bundle stories instantly (in milliseconds)
- Automatically find any stories inside the `stories/` folder
- Support using module path aliases like `@acme/ui` for imports
- Write MDX for component documentation pages

For example, here's the included Story for our `Button` component:

```js:apps/docs/stories/button.stories.mdx
import { Button } from '@acme/ui/button';
import { Meta, Story, Preview, Props } from '@storybook/addon-docs/blocks';

<Meta title="Components/Button" component={Button} />

# Button

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec euismod, nisl eget consectetur tempor, nisl nunc egestas nisi, euismod aliquam nisl nunc euismod.

## Props

<Props of={Box} />

## Examples

<Preview>
  <Story name="Default">
    <Button>Hello</Button>
  </Story>
</Preview>
```

This example includes a few helpful Storybook scripts:

- `pnpm dev`: Starts Storybook in dev mode with hot reloading at `localhost:6006`
- `pnpm build`: Builds the Storybook UI and generates the static HTML files
- `pnpm preview-storybook`: Starts a local server to view the generated Storybook UI

## Versioning & Publishing Packages

This example uses [Changesets](https://github.com/changesets/changesets) to manage versions, create changelogs, and publish to npm. It's preconfigured so you can start publishing packages immediately.

You'll need to create an `NPM_TOKEN` and `GITHUB_TOKEN` and add it to your GitHub repository settings to enable access to npm. It's also worth installing the [Changesets bot](https://github.com/apps/changeset-bot) on your repository.

### Generating the Changelog

To generate your changelog, run `pnpm changeset` locally:

1. **Which packages would you like to include?** – This shows which packages and changed and which have remained the same. By default, no packages are included. Press `space` to select the packages you want to include in the `changeset`.
1. **Which packages should have a major bump?** – Press `space` to select the packages you want to bump versions for.
1. If doing the first major version, confirm you want to release.
1. Write a summary for the changes.
1. Confirm the changeset looks as expected.
1. A new Markdown file will be created in the `changeset` folder with the summary and a list of the packages included.

### Releasing

When you push your code to GitHub, the [GitHub Action](https://github.com/changesets/action) will run the `release` script defined in the root `package.json`:

```bash
turbo run build --filter=docs^... && changeset publish
```

Turborepo runs the `build` script for all publishable packages (excluding docs) and publishes the packages to npm. By default, this example includes `acme` as the npm organization. To change this, do the following:

- Rename folders in `packages/*` to replace `acme` with your desired scope
- Search and replace `acme` with your desired scope
- Re-run `pnpm install`

To publish packages to a private npm organization scope, **remove** the following from each of the `package.json`'s

```diff
- "publishConfig": {
-  "access": "public"
- },
```

```sh

device_id=019b08df-26e7-7506-a5f6-916b2bef24f4,sensor_type=i_avg value=2.54 1770327318000000000



device_id=019b08df-26e7-7119-97da-523f9236db80,sensor_type=a_minus value=-1317.03 1770327329000000000



device_id=019b08df-26e7-71b5-8df6-56c2e954ac91,sensor_type=u_ll_avg value=213.9 1770327345000000000



device_id=019b08df-26e7-7506-a5f6-916b2bef24f4,sensor_type=i_avg value=2.54 1770327318000000000



device_id=019b08df-26e7-7119-97da-523f9236db80,sensor_type=a_minus value=-1317.03 1770327329000000000



device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=u_ll_avg value=223.53 1770327286000000000

```

sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=a_plus,type=float value=1629.75 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=a_minus,type=float value=-188.45 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=q_minus,type=float value=-1418.69 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=data,type=string value="<data_omitted>" 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=u_ll_avg,type=float value=223.52 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=frequency,type=float value=60.04 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=p_total,type=float value=515.94 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=power_factor,type=float value=0.96 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=q_plus,type=float value=191.73 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=error_code,type=float value=0 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=i_avg,type=float value=1.39 1770410749000000000
sensor_data,device_id=019b08df-26e7-7866-a0fb-1768122b8584,sensor_type=q_total,type=float value=-153.15 1770410749000000000

TODO:
Generate event_id in boundaries: ok
MQTT-to-gRPC bridge ok
gRPC CLI ingestion
Edge gateway

Update Proto in code ok

Write telemetry_ingest with raw, org, device, event
raw_payload
