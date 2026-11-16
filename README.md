# MyUI

MyUI is a copy-and-paste React component library. It provides accessible, typed components built with Radix UI, Tailwind CSS, and the shadcn registry.

## Component categories

The directory groups its 63 components under these single-word labels:

- **Actions**: buttons, button groups, toggles, and toggle groups.
- **Forms**: inputs, selection controls, calendars, fields, and questionnaires.
- **Navigation**: breadcrumbs, carousels, menus, pagination, sidebars, and tabs.
- **Overlays**: dialogs, drawers, menus, popovers, sheets, and tooltips.
- **Feedback**: alerts, empty states, progress indicators, skeletons, spinners, toasts, and traces.
- **Layout**: aspect ratios, direction, resizable panels, scroll areas, and separators.
- **Data**: avatars, badges, cards, charts, items, keyboard keys, markers, and tables.
- **Content**: attachments, chat bubbles, code blocks, messages, and message scrollers.
- **Disclosure**: accordions and collapsible panels.
- **Commands**: command menus and palettes.

## Install a component

Use the shadcn CLI to add a component to your project:

```bash
pnpm dlx shadcn@latest add zhijunio/my-ui-library/button
```

Replace `button` with a component name, such as `dialog` or `input`.

## Run the site locally

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Work with the registry

The root `registry.json` contains the component definitions. Regenerate it after changing UI components, then validate it or build the static registry:

```bash
pnpm registry:generate
pnpm registry:validate
pnpm registry:build
```

To generate registry entries that use GitHub item URLs, pass the repository name:

```bash
pnpm registry:generate -- --github zhijunio/my-ui-library
pnpm registry:build
```

For local installation from the generated static registry, start the site and run this command from the consuming project:

```bash
pnpm dlx shadcn@latest add http://localhost:3000/r/button.json
```

## Development commands

- `pnpm lint` checks the project with Biome.
- `pnpm format` formats supported source files with Biome.
- `pnpm registry:generate` updates `registry.json` from `src/components/ui`.
- `pnpm registry:validate` checks the registry definitions.
- `pnpm registry:build` validates the registry and builds static registry files in `public/r`.
