# MIT - Model IQ Test Design System

> **Canonical source:** [`../../DESIGN.md`](../../DESIGN.md). This supporting file must not override the confirmed root design direction.

**Direction:** Warm editorial technical workbench
**Primary reference:** Claude-inspired visual logic, adapted to MIT identity
**Scope:** Visual system only; product semantics and privacy behavior remain unchanged

## Principles

- Use a warm cream canvas instead of pure white or cool gray.
- Pair editorial serif display headings with a readable humanist sans-serif UI face.
- Reserve coral for primary actions, active states, and small status signals.
- Alternate cream content surfaces with dark product/result surfaces to create rhythm.
- Prefer color-block hierarchy over borders and shadows.
- Keep the API key in page memory only; never introduce browser persistence.
- Text tests report deterministic correctness states; Pelican output remains user-inspected.

## Color Tokens

| Role | Value |
|---|---|
| Canvas | `#FAF9F5` |
| Surface | `#FFFDF9` |
| Soft surface | `#F5F0E8` |
| Card surface | `#EFE9DE` |
| Ink | `#141413` |
| Body | `#3D3D3A` |
| Muted | `#6C6A64` |
| Hairline | `#E3DDD4` |
| Primary coral | `#CC785C` |
| Coral active | `#A9583E` |
| Product dark | `#181715` |
| Product dark elevated | `#252320` |

## Typography

- Display: `Noto Serif CJK SC`, `Source Han Serif SC`, `Songti SC`, `STSong`, `Georgia`, serif.
- Interface/body: `Segoe UI Variable`, `Noto Sans SC`, `Microsoft YaHei UI`, sans-serif.
- Code: `Cascadia Code`, `Cascadia Mono`, `Consolas`, monospace.
- Display headings use regular or medium weight with slightly negative tracking; do not make them heavy bold.

## Geometry

- Controls: `12px` radius.
- Content cards: `20px` radius.
- Main workbench shell: `28px` radius.
- Badges and compact status controls: pill radius.
- Use generous internal spacing: generally `24–40px` inside workbench sections.

## Surface Rhythm

1. Warm cream page canvas.
2. White-cream workbench heading.
3. White-cream test selection area with two multi-select cards.
4. Dark run bar with one coral primary action.
5. Model connection form lives in a separate modal surface.

## Components

- Inputs use warm light surfaces, hairline borders, and a translucent coral focus ring.
- Secondary buttons remain cream with a warm-gray outline.
- The primary run button is coral and should remain the strongest action on the page.
- Test selection uses two checkable cards: Candy Test and Pelican Test. Either or both may be selected.
- Model URL, API key, model ID, and protocol are configured in a separate modal.
- Shadows are subtle and limited to the main shell, floating feedback, and selected tab.

## Responsive Rules

- Desktop uses an editorial introduction column beside the workbench.
- Below `980px`, stack the introduction and workbench.
- Below `680px`, collapse all form and test grids to one column.
- Maintain visible focus states, minimum practical touch targets, and reduced-motion behavior.

## Avoid

- Generic AI purple and cyan gradients.
- Pure-white pages and cool gray dashboard chrome.
- Heavy bold serif headings.
- Coral applied to every selectable element.
- Excessive bordered boxes or layered drop shadows.
- Brand logos, proprietary fonts, or copied product wording from the visual reference.
