# iOS design system

Omnipolymath requires iOS/iPadOS 26.2 or newer and follows the native iOS 26 design language. Use SwiftUI system structure first, Liquid Glass for interactive chrome, and quiet opaque surfaces for content.

## Principles

- Prefer `NavigationStack`, `List`, `Form`, toolbars, sheets, and system controls. They adopt the current platform appearance automatically.
- Root navigation uses one black sidebar on every idiom: persistent in wide landscape and a push-reveal layer behind the content on phones, portrait, and narrow layouts.
- Reserve Liquid Glass for navigation and interactive controls. Do not apply glass to every card, row, or status surface.
- Keep content hierarchy clear with typography, spacing, and grouping before adding backgrounds.
- Use semantic colors. Red means destructive or stopped; orange means attention; green means healthy. Neutral actions use the app accent.
- Preserve Dynamic Type, VoiceOver labels, Reduce Motion, increased contrast, and 44-point touch targets.
- Use continuous corners and concentric geometry. Nested controls should visually follow their container shape.

Apple references: [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views), and [Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/).

## Tokens

`OmnipolymathProMetric` in `Sources/Design/OmnipolymathProComponents.swift` is the source of truth for shared geometry:

- `pagePadding`: standard page gutter
- `cardRadius`: content group radius
- `controlRadius`: inset control radius
- `drawerRadius`: all-corner radius for compact content while the sidebar is revealed
- `compactControlSize`: compact circular control size
- `bottomScrollInset`: clearance above persistent navigation

Feature-local layout enums may define row heights and grid dimensions, but should reference the shared radius instead of introducing a new card shape.

## Components

- `OmnipolymathProBackground`: grouped page background
- `ProCard`: quiet content grouping; never Liquid Glass
- `ProIconBadge`: compact semantic indicator
- `OmnipolymathNoticeBanner`: shared connection and runtime notices
- `OmnipolymathAdaptiveHeaderRow`: responsive destination heading
- `OmnipolymathGlassControlGroup`: performance and morphing boundary for nearby glass controls
- `OmnipolymathSidebarPalette`: fixed black-sidebar colors that remain dark in every app appearance
- `OmnipolymathSidebarControlButton`, `OmnipolymathSidebarToolbarItem`: shared leading toolbar affordance
- `omnipolymathGlassButton(prominent:tint:)`: system Liquid Glass button
- `OmnipolymathPrimaryActionButtonStyle`, `OmnipolymathSecondaryActionButtonStyle`, `OmnipolymathCloseButtonStyle`: capsule buttons built on `omnipolymathButtonSurface` with system Liquid Glass
- `omnipolymathProminentButton()`: system prominent button filled with `OmnipolymathBrand.accentFill`

## Accent roles

`OmnipolymathBrand.accent` is the readable foreground accent for text, glyphs, and the app tint; it brightens in dark mode to keep 4.5:1 on dark surfaces. `OmnipolymathBrand.accentFill` is the darker accent for backgrounds that carry white content (prominent buttons, toggles). Never use `accent` as a fill under white text, and never use `accentFill` as text. Custom button surfaces use no gradients, sheens, or shadows; they read as a muddy halo on dark backgrounds.

## Liquid Glass rules

Use `omnipolymathGlassButton` for primary actions and navigation-adjacent controls. Use the prominent style for one primary action per region. Wrap nearby controls in `OmnipolymathGlassControlGroup`. Shared sidebar reveal controls and Chat actions are the background-free header exceptions; they retain 44-point hit targets without adding separate circles around their glyphs.

Do not place Liquid Glass behind reading content, forms, metrics, or every card in a scroll view. Excess glass weakens hierarchy, increases rendering cost, and competes with the sidebar and navigation chrome.

Guard APIs newer than the iOS 26.2 deployment target with availability checks. Any fallback must preserve the same label, action, tint meaning, accessibility, and approximate hit target.

## Review checklist

- Uses a native container or control where one exists.
- Uses shared spacing and corner tokens.
- Has one obvious primary action.
- Keeps semantic color independent from decoration.
- Works in light and dark mode, Dynamic Type, and compact phone layouts.
- Verifies appearance on supported iOS versions in the simulator.
- Adds matched before/after evidence for a visual change.
