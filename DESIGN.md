# MIT - Model IQ Test Design Direction

> **Status:** Confirmed and frozen by the user on 2026-09-29.
> **Authority:** This is the canonical visual standard for the project.
> **Change policy:** Do not reselect, blend, or replace the primary visual reference unless the user explicitly asks to reconsider the design direction.

## Direction

MIT uses a **warm editorial technical-workbench** design language inspired by Claude's visual logic and adapted to MIT's own identity.

The reference is used only for visual principles: warm cream surfaces, editorial serif headings, restrained coral emphasis, dark technical/result surfaces, generous spacing, and color-block hierarchy. Do not copy Claude or Anthropic names, logos, proprietary illustrations, product wording, or licensed fonts into the interface.

## Product Character

- Calm, objective, trustworthy, and human rather than cold or corporate.
- A focused testing tool, not a marketing landing page or analytics dashboard.
- Editorial typography provides personality; controls remain clear and practical.
- Interface density stays moderate: enough context to understand the workflow without filling the page with panels.
- Results and technical output may use dark surfaces; setup and selection use warm light surfaces.

## Product Invariants

Visual work must preserve these requirements:

- The product name is `MIT - Model IQ Test`.
- The main heading is `模型降智测试`.
- Available tests are `红绿色盲测试`, `糖果测试`, and `鹈鹕测试`; users may select one or multiple tests.
- Text tests use deterministic outcomes such as `正确 / 错误 / 无法解析`.
- The Pelican test checks only whether returned text contains HTML and SVG tags, preserves raw output, and displays complete HTML in a sandbox with external resources blocked. Visual and animation quality are not automatically judged.
- Model URL, API key, model ID, and protocol live in a separate configuration modal.
- Mount all selected tests together and run their independent requests concurrently. Each result has a neutral secondary retry control; keep other results intact and disable only that item's retry while it is pending. Keep the current run configuration in result-page memory for explicit retries, and clear it on refresh or close. Do not persist credentials.
- API keys remain in memory only. Following the user's approved server-relay architecture, an explicit connection check or test sends the key to the same-origin relay, which temporarily forwards it to the specified allowed API. Do not add credential logging, disk persistence, localStorage, sessionStorage, IndexedDB, analytics capture, task persistence, or automatic key submission. Disclose the relay in the configuration UI.
- Do not invent rankings, subjective intelligence scores, AI judges, or unsupported tests.

## Core Palette

### Light mode

| Token | Value | Use |
|---|---:|---|
| `canvas` | `#F0EEE6` | Page background; warm parchment atmosphere |
| `surface` | `#FAF9F5` | Main workbench, cards, and inputs |
| `surface-soft` | `#F0EEE6` | Quiet section bands continuous with the canvas |
| `surface-card` | `#E3DACC` | Hovered controls and secondary grouped surfaces |
| `surface-feature` | `#F5E3C7` | Selected test card and rare editorial emphasis |
| `ink` | `#141413` | Headings and primary text |
| `body` | `#3D3D3A` | Running text |
| `muted` | `#6C6A64` | Supporting copy |
| `muted-soft` | `#87867F` | Fine print and captions |
| `hairline` | `#CCCBC8` | Warm low-contrast borders |
| `coral` | `#D97757` | The single consequential primary action |
| `coral-active` | `#C6613F` | Pressed/active coral |
| `product-dark` | `#141413` | Technical output surfaces |
| `product-dark-elevated` | `#3D3D3A` | Elevated content on dark surfaces |
| `on-dark` | `#FAF9F5` | Primary text on dark surfaces |
| `on-dark-soft` | `#AAA69E` | Secondary text on dark surfaces |

### Dark mode

- Page: `#181715`
- Main surface: `#1F1E1B`
- Soft surface: `#252320`
- Card surface: `#302D28`
- Primary text: `#FAF9F5`
- Body text: `#DDD8CF`
- Hairline: `#37342F`
- Coral: `#DD8A6F`
- Deep result surface: `#10100F`

Dark mode must remain warm and neutral. Do not introduce cool slate, AI purple, cyan, neon gradients, or blue-tinted gray.

## Color Usage

- Coral is reserved for the main run action and its pressed state. Do not use it for selection, focus, decoration, or status text.
- Selected cards use `surface-feature`, an ink border, and an ink check so state remains visible without spending the accent color.
- Use cream-to-dark contrast as the primary pacing mechanism.
- Borders should feel like one subtle elevation step, not visible boxes around every element.
- Do not use shadows for elevation. Use surface-color changes and 1px borders instead.

## Typography

Use practical system/open fallbacks rather than proprietary reference fonts.

### Display

```css
"Sitka Text", "Noto Serif SC", Georgia, serif
```

- Used for the page title, section headings, test names, and modal heading.
- Latin characters use the locally installed Sitka Text as a license-safe editorial substitute; Chinese editorial text uses Noto Serif SC.
- Weight: `400–500`; never heavy bold.
- Slight negative letter-spacing is encouraged at large sizes.
- Desktop page title: approximately `44–64px`, line-height near `1.08`.

### Interface and body

```css
"Noto Sans SC", "Segoe UI Variable", "Microsoft YaHei UI", sans-serif
```

- Used for controls, form labels, buttons, status, navigation, and compact supporting copy.
- The main introduction paragraph is an editorial exception: use the display stack at approximately `18–20px` with relaxed leading.
- Body weight: `400`; labels and buttons: `500–600`.
- Default body line-height: approximately `1.6`.

### Code and technical labels

```css
"Cascadia Code", "Cascadia Mono", Consolas, monospace
```

- Used for API fragments, fixed prompts, small test codes, and raw technical output.

## Spacing

- Base unit: `4px`.
- Common steps: `8`, `12`, `16`, `24`, `32`, `40`, `48`, `64`, `96px`.
- Workbench sections use `24–40px` internal padding.
- Major page bands use generous breathing room rather than extra decoration.
- Desktop content should stay centered and capped around `1200–1380px`, depending on the screen structure.

## Geometry

The interface should feel soft but not bubbly.

| Element | Radius |
|---|---:|
| Compact control | `8px` |
| Input/outlined button | `8px` |
| Primary filled button | `8px` on all four corners |
| Test or content card | `14px` |
| Main workbench shell | `16px` |
| Configuration modal | `16px` |
| Status label | Unboxed text by default |
| Wordmark | Text only; no separate icon |

Avoid both sharp rectangular dashboard chrome and excessive capsule shapes. Do not use pills for ordinary actions or status labels. Following the user's 2026-10-01 feedback, use smaller, consistent corners inspired by Apple's restrained control geometry; these are project-specific values, not official Apple dimensions.

## Layout

### Desktop

- A restrained sticky header contains the MIT wordmark, temporary-session state, and theme control.
- The main page uses an editorial introduction column beside the testing workbench.
- The introduction explains the three-step workflow and key privacy boundary.
- The workbench presents test selection first; connection settings do not occupy the main canvas.
- Tests use compact checkable cards in an adaptive grid: columns are at least `200px` where space permits, and mobile uses one column. The grid can accommodate additional tests without changing its structure.
- A warm-gray beige run bar (`surface-card`, `#E3DACC` in light mode) closes the workbench and carries the only strong coral CTA. Use ink text and a cream secondary action; dark mode follows the warm card token.

### Model configuration

- Open model settings in a dedicated modal rather than embedding the full form inside the test workbench.
- The modal contains API Base URL, API Key, Model ID, protocol, an explicit streaming toggle (on by default), and connection check with its actual token usage. Keep the 64-token probe limit visible; distinguish a completed check from reachability with an incomplete answer.
- Use a warm surface header and soft-cream form band.
- The modal must close via its close button, backdrop click, and Escape.

### Responsive behavior

- Below `980px`, stack the introduction above the workbench.
- Below `680px`, use one-column test cards and form fields.
- The configuration modal must fit within `calc(100dvh - 32px)` and scroll internally when required.
- Avoid horizontal scrolling at `390px` width and above.
- Primary controls should provide practical touch targets of at least `40px`, preferably `44–48px`.

## Component Rules

### Primary action

- Clay/coral background with light text in light mode; this is the only filled chromatic control.
- Minimum height about `48px` for the main run action.
- Pressed state darkens toward `coral-active`.
- Disabled state uses the dark-elevated neutral and muted text.
- Use a consistent `8px` radius on all four corners, matching secondary buttons instead of a pill or bottom-only rounding.

### Secondary action

- Warm cream background with a warm-gray hairline border.
- Do not compete visually with the run action.

### Inputs

- Warm light surface, `8px` radius, `1px` hairline.
- Focus uses an ink border and low-opacity ink outer ring.
- Placeholder text uses the muted-soft token.

### Test selection cards

- Keep cards compact: `184px` minimum height on desktop, `164px` on mobile, `16px` padding, `22px` headings, and `12px` grid gaps. Allow height to grow for longer descriptions rather than clipping content.
- Three current product choices: Color Blindness, Candy, and Pelican.
- Use native checkboxes hidden visually but preserved semantically.
- Selected state: manilla `surface-feature`, ink border, and ink check square.
- Each card states what it tests and how its result is treated.
- Users may select any combination or none; when neither is selected, disable the run action.

### Technical/result surfaces

- The separate run/result page uses an open document layout: no outer workbench border, no boxed result cards, and no nested frames around validation details. Use whitespace, headings, and thin separators between tests. Artwork previews have no decorative border.

- Use `product-dark` for raw code and prompts. The selection-page run bar uses `surface-card` with ink text.
- Use cream-tinted text rather than pure white.
- Technical content uses the monospace stack; headings may remain editorial serif.
- Text answers open as readable Markdown on the warm canvas, with clear headings, emphasis, lists, quotations, tables and code blocks. Keep exact raw text in a separate collapsed disclosure; validation uses that original text. Do not render generated HTML or fetch remote images in the host document.
- Pelican artwork expands to its measured content height, with no internal vertical scrollbar; the report page scrolls normally. Preserve its restricted sandbox and CSP. Raw HTML source remains accessible in a separate disclosure without a fixed-height scrolling window.

### Feedback

- Toasts use a compact dark elevated surface.
- Motion is subtle: `150–200ms` state transitions and small vertical offsets only.
- Respect `prefers-reduced-motion`.

## Accessibility

- Maintain visible keyboard focus on every interactive element.
- Preserve semantic headings, labels, checkbox roles, dialog semantics, and live status feedback.
- Light-mode text must meet WCAG AA contrast where applicable.
- Do not communicate selection or errors through color alone.
- Keep form labels visible; placeholders are supplementary, not replacements.

## Do

- Use warm cream as the default atmosphere.
- Use serif display typography to create editorial character.
- Alternate cream content with dark technical/result surfaces.
- Let spacing, type, and color blocks create hierarchy.
- Keep the interface focused on configuring a model, selecting tests, and viewing raw results.

## Do Not

- Do not copy Claude/Anthropic logos, marks, illustrations, or product copy.
- Do not use generic AI purple/cyan gradients, neon glows, glassmorphism, HUD decoration, or cyberpunk styling.
- Do not add unnecessary navigation, dashboard metrics, rankings, scores, or decorative cards.
- Do not use heavy serif weights or excessive all-caps text.
- Do not apply coral outside the primary run action.
- Do not persist or transmit an API key without explicit user-approved functionality.

## Implementation Priority

When guidance conflicts, use this order:

1. Explicit user instructions and product/privacy requirements.
2. This root `DESIGN.md`.
3. Existing project implementation and the supporting `design-system/model-iq-test/MASTER.md`.
4. General frontend or design-skill defaults.

Future design work should read this file first and should not run another design-reference selection unless the user explicitly asks to change or reconsider the visual direction.
