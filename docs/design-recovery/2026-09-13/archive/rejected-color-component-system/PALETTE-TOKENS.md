# Workbench palette candidates

All three candidates use the approved Full Hero geometry without any layout change. They share one luminance ladder and keep brand accent separate from runtime semantics. Values below are the exact prototype tokens.

| Token | Graphite Ember | Slate Signal | Mineral Quiet |
|---|---:|---:|---:|
| `canvas` | `#111315` | `#0E1217` | `#121217` |
| `shell` | `#0A0C0E` | `#090C10` | `#0B0B0F` |
| `surface-1` | `#16191C` | `#141920` | `#17171C` |
| `surface-2` | `#1B1F23` | `#192129` | `#1D1D23` |
| `surface-3` | `#22272C` | `#202A34` | `#25252C` |
| `glass` | `rgba(26, 30, 34, 0.78)` | `rgba(21, 28, 36, 0.78)` | `rgba(28, 28, 34, 0.78)` |
| `border` | `rgba(235, 239, 242, 0.13)` | `rgba(225, 235, 242, 0.14)` | `rgba(235, 232, 240, 0.13)` |
| `subtle-border` | `rgba(235, 239, 242, 0.065)` | `rgba(225, 235, 242, 0.07)` | `rgba(235, 232, 240, 0.065)` |
| `text-primary` | `#EEF0F2` | `#EAF0F4` | `#EFEDF2` |
| `text-secondary` | `#AAB1B8` | `#A5B0BA` | `#ADA9B2` |
| `text-tertiary` | `#7E878F` | `#7C8995` | `#827E89` |
| `accent` | `#C87868` | `#78A8B3` | `#9A8DA3` |
| `hover` | `rgba(255, 255, 255, 0.055)` | `rgba(232, 244, 250, 0.058)` | `rgba(245, 240, 248, 0.055)` |
| `selected` | `rgba(200, 120, 104, 0.15)` | `rgba(120, 168, 179, 0.15)` | `rgba(154, 141, 163, 0.16)` |
| `focus-ring` | `#E2A094` | `#A3CAD2` | `#BEB1C5` |
| `success` | `#7FB89A` | `#7FB89A` | `#7FB89A` |
| `warning` | `#D2A766` | `#D2A766` | `#D2A766` |
| `danger` | `#D77872` | `#D77872` | `#D77872` |
| `running` | `#7B9FC7` | `#7B9FC7` | `#7B9FC7` |
| `shadow` | `0 24px 64px rgba(0, 0, 0, 0.48)` | `0 24px 64px rgba(0, 0, 0, 0.52)` | `0 24px 64px rgba(0, 0, 0, 0.50)` |

## Source fidelity

- **Graphite Ember** follows the Design Intent directly: black / blue-black / deep gray glass with one restrained warm-red brand accent. It is the closest literal recovery candidate.
- **Slate Signal** materializes the repository's existing gray-cyan accent lineage from `src/design/tokens.css`, but reduces saturation and keeps it out of semantic runtime states.
- **Mineral Quiet** tests a nearly neutral graphite system with a muted mineral-violet accent. It preserves the same contrast ladder and semantic colors, so the choice is about product character rather than status meaning.

None of the candidates uses the rejected olive, paper, or acid-lime palette. Color does not define panel boundaries; luminance, blur, spacing, and hairline borders do.
