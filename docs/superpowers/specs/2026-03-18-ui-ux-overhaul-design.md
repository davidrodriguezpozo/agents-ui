# UI/UX Overhaul Design Spec

## Overview
Comprehensive visual and interaction overhaul of the Claude Code Agent Manager to elevate it from "well-made admin panel" to "premium platform." The design direction is "Precision Instrument" — Raycast meets Linear meets Ableton.

## 1. Typography Overhaul

### Font Changes
- **Display/Headings**: Replace Sora with **Clash Display** (Fontshare) for page titles and hero numbers
- **Body**: Replace Sora with **Geist Sans** for descriptions, labels, UI text
- **Mono**: Replace IBM Plex Mono with **Geist Mono** for code, file paths, technical values

### Scale Changes
- Page titles: 24-28px (from 17px), semibold, tight tracking
- Section headers: 14px semibold, mixed case (from 10px uppercase)
- Body: 13-14px (unchanged)
- Metadata/labels: 11px (from 10px)
- Remove excessive uppercase — reserve for badges and status indicators only

### Files Modified
- `nuxt.config.ts` — font imports
- `app/assets/css/main.css` — `--font-sans`, `--font-display`, `--font-mono` variables + typography classes

## 2. Dashboard Bento Grid Layout

### Layout
Asymmetric grid replacing vertical card stack:
```
┌──────────────────────────────────────────┐
│  Hero Stat Bar (48px numbers, gradient)  │
├──────────────────────┬───────────────────┤
│  Agents (featured    │  Model Breakdown  │
│  cards, larger)      │  (proportional    │
│                      │   bar chart)      │
├──────────┬───────────┤                   │
│ Commands │ Quick     ├───────────────────┤
│          │ Actions   │  Suggestions      │
└──────────┴───────────┴───────────────────┘
```

- Hero stat bar: 48px numbers, accent gradient background bleed
- Model breakdown: visual proportional bar (not just text)
- Number counters: animate from 0 on page load

### Files Modified
- `app/pages/index.vue` — complete layout restructure

## 3. Agent Detail Split Layout + Editor

### Split Layout
- Left panel (60%): Configuration form
- Right panel (40%): Fixed sidebar with quality score, skills, version history, file location

### Editor Upgrade
- Recessed dark background (even in light mode)
- Line numbers in left gutter
- 14px mono font
- Focused line highlight
- Larger min-height

### Files Modified
- `app/pages/agents/[slug].vue` — split layout + editor styling

## 4. Color System Enhancements

### Secondary Accent
- Add slate blue secondary accent for links, info states, secondary actions
- `--accent-secondary: #6366f1` (light) / `#818cf8` (dark)

### Dark Mode Depth
- Base: `#09090b`
- Sidebar: `#0c0c10` with subtle blue tint
- Raised: `#141418`
- Overlay: `#1c1c22`
- Warm amber tinting on dark surfaces

### Enhanced Glows
- Stronger accent glow on active elements
- Agent cards emit color glow on hover
- Pronounced input focus glow

### Files Modified
- `app/assets/css/main.css` — all color tokens

## 5. Micro-interactions & Motion

### Card Interactions
- Hover: `scale(1.01)` + deeper shadow + slight translateY(-2px)
- Press: `scale(0.98)` + darker background
- Agent cards: frosted glass effect on hover

### Button States
- `:active` with `scale(0.97)` + darker background
- Save confirmation: inline green checkmark animation

### Page Transitions
- Enhanced translateY (12px from, -6px to)
- Content stagger on page entry

### Pill Picker
- Sliding indicator that animates between positions (CSS transition on a pseudo-element)

### Number Animations
- Dashboard counters animate from 0 using requestAnimationFrame

### Files Modified
- `app/assets/css/main.css` — hover/active/transition classes
- `app/pages/index.vue` — counter animation
- Various components — interaction states

## 6. Sidebar Refinements

### Visual Changes
- Width: 200px (from 220px)
- Active item: gradient background (accent-muted to transparent)
- Active count badge: accent color (not disabled)
- Stronger ambient glow
- Nav hover: smooth background reveal

### Files Modified
- `app/app.vue` — sidebar template + styles

## 7. Component Polish

### Agent Cards
- 4-5px color bar (from 3px)
- Frosted glass on hover
- Better description reveal

### Chat Panel
- Distinct background tint
- Slide-in animation from right
- Message slide-in animations

### Graph Page
- Animated edges (stroke-dashoffset)
- Stronger dim effect on unconnected nodes

### Empty States
- SVG illustrations replacing text-only states

### Global Polish
- `::selection` with amber accent at 20% opacity
- Auto-hiding scrollbars
- Enhanced focus states with glow + ring

### Files Modified
- Multiple component files
- `app/assets/css/main.css` — global polish classes
