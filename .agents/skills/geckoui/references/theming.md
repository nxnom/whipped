# GeckoUI Theming Reference

GeckoUI uses CSS custom properties with OKLCH color values. Override with any CSS color format: `oklch()`, `hex`, `rgb()`, `hsl()`.

## How to Create a Custom Theme

Create a CSS file that overrides the `--color-*` variables, import it AFTER `@geckoui/geckoui/styles.css`:

```tsx
import "@geckoui/geckoui/styles.css";

import "./my-theme.css";
```

## Complete Variable Reference

### Primary Colors (brand color scale)

These control buttons, focus rings, active states, and all accent colors.

```css
:root {
  --color-primary-50: oklch(0.9705 0.0142 254.6); /* lightest */
  --color-primary-100: oklch(0.9319 0.0316 255.59);
  --color-primary-200: oklch(0.8823 0.0571 254.13);
  --color-primary-300: oklch(0.8091 0.0956 251.81); /* focus rings */
  --color-primary-400: oklch(0.7137 0.1434 254.62); /* hover borders */
  --color-primary-500: oklch(0.6231 0.188 259.81);
  --color-primary-600: oklch(0.5461 0.2152 262.88); /* primary button bg */
  --color-primary-700: oklch(0.4882 0.2172 264.38); /* primary button hover */
  --color-primary-800: oklch(0.4244 0.1809 265.64);
  --color-primary-900: oklch(0.3791 0.1378 265.52);
  --color-primary-950: oklch(0.2823 0.0874 267.94); /* darkest */
}
```

### Surface Colors (backgrounds)

```css
:root {
  --color-surface-primary: oklch(1 0 none); /* main background */
  --color-surface-secondary: oklch(0.9851 0 none); /* secondary bg */
  --color-surface-tertiary: oklch(0.9702 0 none); /* tertiary bg */
  --color-surface-hover: oklch(0.9702 0 none); /* hover state */
  --color-surface-hover-strong: oklch(0.9401 0 none); /* strong hover (menus) */
  --color-surface-active: oklch(0.8699 0 none); /* active/pressed */
  --color-surface-disabled: oklch(0.9401 0 none); /* disabled bg */
  --color-surface-overlay: oklch(0 0 none); /* backdrop overlay */
  --color-surface-autofill: oklch(0.9702 0 none); /* browser autofill */
  --color-surface-emphasis: oklch(0.4461 0.0263 256.8); /* emphasis bg */
}
```

### Text Colors

```css
:root {
  --color-text-primary: oklch(0.2046 0 none); /* main text */
  --color-text-secondary: oklch(0.3715 0 none); /* secondary text */
  --color-text-tertiary: oklch(0.5555 0 none); /* tertiary text */
  --color-text-disabled: oklch(0.7155 0 none); /* disabled text */
  --color-text-placeholder: oklch(0.7155 0 none); /* placeholder */
  --color-text-inverse: oklch(0.9851 0 none); /* text on dark bg */
  --color-text-muted: oklch(0.5555 0 none); /* muted text */
  --color-text-on-primary: oklch(1 0 none); /* text on primary color */
}
```

### Border Colors

```css
:root {
  --color-border-primary: oklch(0.9401 0 none); /* default border */
  --color-border-secondary: oklch(0.8699 0 none); /* input borders */
  --color-border-focus: oklch(0.7155 0 none); /* focus state */
  --color-border-hover: oklch(0.8699 0 none); /* hover state */
  --color-border-disabled: oklch(0.9401 0 none); /* disabled border */
}
```

### Scrollbar Colors

These use the `--gecko-ui-` prefix (not Tailwind utilities):

```css
:root {
  --gecko-ui-scrollbar-track: oklch(0 0 none);
  --gecko-ui-scrollbar-thumb: oklch(0.8717 0.0093 258.34);
  --gecko-ui-scrollbar-thumb-hover: oklch(0.7137 0.0192 261.32);
}
```

## Dark Mode

Apply `.dark` class to root element. Override the same variables:

```css
.dark {
  --color-surface-primary: oklch(0.2046 0 none);
  --color-surface-secondary: oklch(0.2435 0 none);
  --color-surface-tertiary: oklch(0.2972 0 none);
  --color-surface-hover: oklch(0.2972 0 none);
  --color-surface-hover-strong: oklch(0.3715 0 none);
  --color-surface-active: oklch(0.5555 0 none);
  --color-surface-disabled: oklch(0.2972 0 none);
  --color-surface-overlay: oklch(0 0 none);
  --color-surface-autofill: oklch(0.2435 0 none);
  --color-surface-emphasis: oklch(0.7748 0.0054 247.89);

  --color-text-primary: oklch(0.9851 0 none);
  --color-text-secondary: oklch(0.8699 0 none);
  --color-text-tertiary: oklch(0.7155 0 none);
  --color-text-disabled: oklch(0.5555 0 none);
  --color-text-placeholder: oklch(0.5555 0 none);
  --color-text-inverse: oklch(0.2046 0 none);
  --color-text-muted: oklch(0.7155 0 none);

  --color-border-primary: oklch(0.4676 0 none);
  --color-border-secondary: oklch(0.4676 0 none);
  --color-border-focus: oklch(0.5555 0 none);
  --color-border-hover: oklch(0.7155 0 none);
  --color-border-disabled: oklch(0.2972 0 none);

  --gecko-ui-scrollbar-track: oklch(0 0 none);
  --gecko-ui-scrollbar-thumb: oklch(0.4461 0.0263 256.8);
  --gecko-ui-scrollbar-thumb-hover: oklch(0.551 0.0234 264.36);
}
```

**Note:** Primary colors (50-950) are NOT overridden in dark mode by default. Override them if your brand color needs dark mode adjustment.

## OKLCH Primer

`oklch(lightness chroma hue)`:

- **Lightness**: 0 (black) to 1 (white)
- **Chroma**: 0 (gray) to ~0.4 (vivid). Use 0 for neutral grays.
- **Hue**: 0-360 degrees. Use `none` for achromatic (gray/black/white).

Common hue angles: red ~25, orange ~70, yellow ~100, green ~145, cyan ~200, blue ~260, purple ~300, pink ~350.

## Output Format

When generating a custom theme, output a single CSS file with this exact structure:

```css
/* theme-name.css */
:root {
  /* Primary — adjust hue for brand color */
  --color-primary-50: oklch(/* L */ /* C */ /* H */);
  --color-primary-100: oklch(/* L */ /* C */ /* H */);
  --color-primary-200: oklch(/* L */ /* C */ /* H */);
  --color-primary-300: oklch(/* L */ /* C */ /* H */);
  --color-primary-400: oklch(/* L */ /* C */ /* H */);
  --color-primary-500: oklch(/* L */ /* C */ /* H */);
  --color-primary-600: oklch(/* L */ /* C */ /* H */);
  --color-primary-700: oklch(/* L */ /* C */ /* H */);
  --color-primary-800: oklch(/* L */ /* C */ /* H */);
  --color-primary-900: oklch(/* L */ /* C */ /* H */);
  --color-primary-950: oklch(/* L */ /* C */ /* H */);

  /* Surface — adjust lightness for overall brightness */
  --color-surface-primary: oklch(/* ... */);
  --color-surface-secondary: oklch(/* ... */);
  --color-surface-tertiary: oklch(/* ... */);
  --color-surface-hover: oklch(/* ... */);
  --color-surface-hover-strong: oklch(/* ... */);
  --color-surface-active: oklch(/* ... */);
  --color-surface-disabled: oklch(/* ... */);
  --color-surface-overlay: oklch(/* ... */);
  --color-surface-autofill: oklch(/* ... */);
  --color-surface-emphasis: oklch(/* ... */);

  /* Text */
  --color-text-primary: oklch(/* ... */);
  --color-text-secondary: oklch(/* ... */);
  --color-text-tertiary: oklch(/* ... */);
  --color-text-disabled: oklch(/* ... */);
  --color-text-placeholder: oklch(/* ... */);
  --color-text-inverse: oklch(/* ... */);
  --color-text-muted: oklch(/* ... */);
  --color-text-on-primary: oklch(/* ... */);

  /* Border */
  --color-border-primary: oklch(/* ... */);
  --color-border-secondary: oklch(/* ... */);
  --color-border-focus: oklch(/* ... */);
  --color-border-hover: oklch(/* ... */);
  --color-border-disabled: oklch(/* ... */);
}

.dark {
  /* Override surface, text, border for dark mode */
  --color-surface-primary: oklch(/* ... */);
  /* ... all surface, text, border variables ... */
}
```

## Rules for Generating Themes

1. **Primary scale**: Keep lightness descending from ~0.97 (50) to ~0.28 (950). Keep chroma consistent. Change only the hue for a new brand color.
2. **Surface grays**: Use chroma 0 and hue `none` for neutral grays. Lightness descends from 1.0 (primary) to 0.87 (active).
3. **Text grays**: Use chroma 0 and hue `none`. Lightness range: 0.20 (primary/darkest) to 0.72 (disabled/lightest).
4. **Border grays**: Use chroma 0 and hue `none`. Lightness range: 0.87 to 0.94.
5. **Dark mode**: Invert lightness — surfaces go dark (0.20-0.37), text goes light (0.55-0.99), borders mid-range (0.30-0.72).
6. **text-on-primary**: Should contrast with primary-600. Usually white `oklch(1 0 none)` for dark primaries, dark `oklch(0.2 0 none)` for light primaries.
7. **Any CSS color format works**: `oklch()`, `#hex`, `rgb()`, `hsl()` are all valid.

## Class Stacking

Some components pass their class to a base component, so multiple `GeckoUI*` classes end up on the **same DOM element**. Styling the base class affects the wrapper too.

| Element                   | Classes on the same element                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `<button>`                | `.GeckoUIButton` + `.GeckoUILoadingButton`                                                   |
| `<label>` (Input wrapper) | `.GeckoUIInput` + `.GeckoUIRHFInput`                                                         |
| `<label>` (Input wrapper) | `.GeckoUIInput` + `.GeckoUIRHFInput` + `.GeckoUIRHFNumberInput`                              |
| `<label>` (Input wrapper) | `.GeckoUIInput` + `.GeckoUIRHFInput` + `.GeckoUIRHFNumberInput` + `.GeckoUIRHFCurrencyInput` |
| `<textarea>`              | `.GeckoUITextarea` + `.GeckoUIRHFTextarea`                                                   |
| `<div>` (Select wrapper)  | `.GeckoUISelect` + `.GeckoUIRHFSelect`                                                       |
| `<div>` (Select button)   | `.GeckoUISelectButton` + `.GeckoUIRHFSelectButton`                                           |
| `<label>` (Switch track)  | `.GeckoUISwitch` + `.GeckoUIRHFSwitch`                                                       |
| `<span>` (Switch thumb)   | `.GeckoUISwitch__thumb` + `.GeckoUIRHFSwitch__thumb`                                         |
| `<div>` (OTP grid)        | `.GeckoUIOTPInput` + `.GeckoUIRHFOTPInput`                                                   |
| `<div>` (Counter wrapper) | `.GeckoUICounterInput` + `.GeckoUIRHFCounterInput`                                           |
| `<div>` (DateRange input) | `.GeckoUIDateInput` + `.GeckoUIDateRangeInput`                                               |

**Impact:** Styling `.GeckoUIInput` also affects `RHFInput`, `RHFNumberInput`, and `RHFCurrencyInput` since they share the same element.

## Component Class Reference

Every CSS class, what HTML element it renders on, and what it targets. Use these for component-level overrides.

### Button

| Class            | Element    | Targets           | Data Attrs                                |
| ---------------- | ---------- | ----------------- | ----------------------------------------- |
| `.GeckoUIButton` | `<button>` | The button itself | `data-variant`, `data-color`, `data-size` |

### LoadingButton

| Class                   | Element    | Targets                                       | Data Attrs     |
| ----------------------- | ---------- | --------------------------------------------- | -------------- |
| `.GeckoUILoadingButton` | `<button>` | Stacks on same `<button>` as `.GeckoUIButton` | `data-loading` |

### Input

| Class                  | Element   | Targets                                                             | Data Attrs                    |
| ---------------------- | --------- | ------------------------------------------------------------------- | ----------------------------- |
| `.GeckoUIInput`        | `<label>` | Outer wrapper (border, flex container with prefix + input + suffix) | `data-state`, `data-readonly` |
| `.GeckoUIInput__input` | `<input>` | The actual text input                                               | —                             |

Built-in: `border`, `rounded-md`, `min-h-10`, `px-3`, `gap-2`.

### Textarea

| Class              | Element      | Targets                     |
| ------------------ | ------------ | --------------------------- |
| `.GeckoUITextarea` | `<textarea>` | The textarea element itself |

Built-in: `border`, `rounded-md`, `px-3`, `py-1.5`, `text-sm`.

### Select

| Class                                                          | Element    | Targets                        | Data Attrs                                              |
| -------------------------------------------------------------- | ---------- | ------------------------------ | ------------------------------------------------------- |
| `.GeckoUISelect`                                               | `<div>`    | Outer wrapper                  | —                                                       |
| `.GeckoUISelectButton`                                         | `<div>`    | The trigger/button area        | `data-state`, `data-readonly`                           |
| `.GeckoUISelectButton__content`                                | `<div>`    | Content area inside button     | —                                                       |
| `.GeckoUISelectButton__value`                                  | `<span>`   | Selected value display         | `data-placeholder`, `data-selected`, `data-hidden`      |
| `.GeckoUISelectButton__search`                                 | `<div>`    | Search input wrapper           | `data-focusonly`, `data-multi-selected`, `data-keyword` |
| `.GeckoUISelectButton__search__input`                          | `<input>`  | The actual search input        | `data-initial`, `data-readonly`                         |
| `.GeckoUISelectButton__icons`                                  | `<div>`    | Icons container (clear, arrow) | —                                                       |
| `.GeckoUISelectButton__clear-button`                           | `<button>` | Clear selection button         | `data-disabled`                                         |
| `.GeckoUISelectButton__multiselected-chip`                     | `<div>`    | Multi-select tag/chip          | `data-disabled`                                         |
| `.GeckoUISelectButton__multiselected-chip__clear-button`       | `<button>` | Remove chip button             | `data-disabled`                                         |
| `.GeckoUISelectButton__multiselected-chip__clear-button__icon` | `<span>`   | Remove chip icon               | —                                                       |
| `.GeckoUISelectMenu`                                           | `<div>`    | Floating dropdown panel        | `data-with-search`                                      |
| `.GeckoUISelectMenu__search-container`                         | `<div>`    | Dropdown search input area     | —                                                       |
| `.GeckoUISelectMenu__items`                                    | `<div>`    | Scrollable options container   | —                                                       |
| `.GeckoUISelectOption`                                         | `<div>`    | Individual option row          | `data-state`, `data-focused`, `data-disabled`           |
| `.GeckoUISelectOption__check-icon`                             | `<div>`    | Check icon when selected       | —                                                       |
| `.GeckoUISelectEmpty`                                          | `<div>`    | Empty state message            | —                                                       |
| `.GeckoUISelectDropdownSearch`                                 | `<label>`  | Dropdown search wrapper        | —                                                       |
| `.GeckoUISelectDropdownSearch__icon`                           | `<div>`    | Search icon                    | —                                                       |

### Menu

| Class                  | Element    | Targets                              | Data Attrs      |
| ---------------------- | ---------- | ------------------------------------ | --------------- |
| `.GeckoUIMenu`         | `<div>`    | Outer wrapper                        | —               |
| `.GeckoUIMenu__button` | `<button>` | Default trigger button               | —               |
| `.GeckoUIMenu__items`  | `<div>`    | Floating dropdown panel (scrollable) | —               |
| `.GeckoUIMenu__item`   | `<div>`    | Individual menu action item          | `data-disabled` |

Built-in panel: `border`, `rounded-md`, `p-1`, `shadow-xl`. Built-in item: `px-3`, `py-2`, `text-sm`, `rounded`.

### Alert

| Class                                | Element    | Targets                            | Data Attrs                       |
| ------------------------------------ | ---------- | ---------------------------------- | -------------------------------- |
| `.GeckoUIAlert`                      | `<div>`    | Alert container                    | `data-variant`, `data-condensed` |
| `.GeckoUIAlert__icon`                | `<div>`    | Variant icon                       | `data-variant`                   |
| `.GeckoUIAlert__body`                | `<div>`    | Header area (icon + title + close) | —                                |
| `.GeckoUIAlert__title`               | `<div>`    | Title text                         | —                                |
| `.GeckoUIAlert__description`         | `<div>`    | Description text                   | —                                |
| `.GeckoUIAlert__remove-button`       | `<button>` | Close/dismiss button               | —                                |
| `.GeckoUIAlert__remove-button__icon` | `<span>`   | Close icon                         | —                                |

Built-in: `border`, `rounded-lg`, `px-4`, `py-3`.

### Dialog

| Class                      | Element | Targets                   | Data Attrs   |
| -------------------------- | ------- | ------------------------- | ------------ |
| `.GeckoUIDialog`           | `<div>` | Root fixed overlay        | `data-state` |
| `.GeckoUIDialog__backdrop` | `<div>` | Semi-transparent backdrop | —            |
| `.GeckoUIDialog__dialog`   | `<div>` | The modal panel           | —            |

Built-in panel: `bg-surface-primary`, `p-6`, `rounded-md`, `shadow-xl`, `max-w-[400px]`. Override via `className`.

### ConfirmDialog

| Class                            | Element | Targets                          |
| -------------------------------- | ------- | -------------------------------- |
| `.GeckoUIConfirmDialog__dialog`  | `<div>` | Dialog wrapper                   |
| `.GeckoUIConfirmDialog__title`   | `<div>` | Title (text-base, font-semibold) |
| `.GeckoUIConfirmDialog__content` | `<div>` | Content (text-sm, text-muted)    |
| `.GeckoUIConfirmDialog__actions` | `<div>` | Button row (flex, justify-end)   |

### Drawer

| Class                      | Element | Targets           | Data Attrs                                              |
| -------------------------- | ------- | ----------------- | ------------------------------------------------------- |
| `.GeckoUIDrawer`           | `<div>` | Root container    | —                                                       |
| `.GeckoUIDrawer__backdrop` | `<div>` | Backdrop overlay  | `data-state="visible" \| "hidden"`, `data-clickthrough` |
| `.GeckoUIDrawer__drawer`   | `<div>` | The sliding panel | `data-placement`, `data-state`                          |

Built-in panel: `bg-surface-primary`, `shadow-xl`, no padding. Override via `className`.

### Tooltip

| Class                      | Element  | Targets                |
| -------------------------- | -------- | ---------------------- |
| `.GeckoUITooltip__trigger` | `<span>` | Trigger wrapper        |
| `.GeckoUITooltip`          | `<div>`  | Tooltip content bubble |
| `.GeckoUITooltip__arrow`   | `<svg>`  | Arrow element          |

### Calendar

| Class                                    | Element    | Targets                            | Data Attrs                                                                                                                                                                                             |
| ---------------------------------------- | ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.GeckoUICalendar`                       | `<div>`    | Calendar wrapper                   | `data-mode`, `data-selection`, `data-calendars`                                                                                                                                                        |
| `.GeckoUICalendar__header`               | `<div>`    | Month/year header with arrows      | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__header__title`        | `<button>` | Month/year title (clickable)       | `data-clickable`                                                                                                                                                                                       |
| `.GeckoUICalendar__header__arrow-button` | `<button>` | Navigation arrow                   | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__day-picker-weekdays`  | `<div>`    | Weekday labels row (S M T W T F S) | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__day-picker`           | `<div>`    | Day grid container                 | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__day-picker__button`   | `<button>` | Individual day cell                | `data-today`, `data-selected`, `data-range-start`, `data-range-end`, `data-in-range`, `data-hover-preview`, `data-hover-preview-start`, `data-hover-preview-end`, `data-disabled`, `data-active-month` |
| `.GeckoUICalendar__month-picker`         | `<div>`    | Month grid                         | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__month-picker__button` | `<button>` | Month cell                         | `data-selected`                                                                                                                                                                                        |
| `.GeckoUICalendar__year-picker`          | `<div>`    | Year grid                          | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__year-picker__button`  | `<button>` | Year cell                          | `data-selected`, `data-prev-next`                                                                                                                                                                      |
| `.GeckoUICalendar__dual`                 | `<div>`    | Flex container for dual calendars  | —                                                                                                                                                                                                      |
| `.GeckoUICalendar__dual__item`           | `<div>`    | Individual calendar in dual view   | `data-position`                                                                                                                                                                                        |

### DateInput / DateRangeInput

| Class                                     | Element    | Targets                             | Data Attrs                                             |
| ----------------------------------------- | ---------- | ----------------------------------- | ------------------------------------------------------ |
| `.GeckoUIDateInputWrapper`                | `<div>`    | Outer wrapper (includes calendar)   | `data-calendar-open`                                   |
| `.GeckoUIDateInput`                       | `<div>`    | Input container (border, flex)      | `data-state`, `data-error`, `data-empty`, `data-focus` |
| `.GeckoUIDateInput__placeholder`          | `<span>`   | Placeholder text                    | —                                                      |
| `.GeckoUIDateInput__display-container`    | `<div>`    | Date segments container             | —                                                      |
| `.GeckoUIDateInput__segment`              | `<label>`  | Individual segment (day/month/year) | `data-empty`                                           |
| `.GeckoUIDateInput__separator`            | `<span>`   | Separator (/) between segments      | —                                                      |
| `.GeckoUIDateInput__prefix`               | `<div>`    | Prefix icon/text area               | —                                                      |
| `.GeckoUIDateInput__suffix`               | `<div>`    | Suffix icon/text area               | —                                                      |
| `.GeckoUIDateInput__icons`                | `<div>`    | Icons container (clear, calendar)   | —                                                      |
| `.GeckoUIDateInput__clear-button`         | `<button>` | Clear button                        | —                                                      |
| `.GeckoUIDateInput__calendar-icon`        | `<div>`    | Calendar icon                       | —                                                      |
| `.GeckoUIDateInput__hidden-input`         | `<input>`  | Hidden input for each segment       | —                                                      |
| `.GeckoUIDateInput__calendar`             | `<div>`    | Floating calendar panel             | —                                                      |
| `.GeckoUIDateRangeInputWrapper`           | `<div>`    | DateRange outer wrapper             | `data-calendar-open`                                   |
| `.GeckoUIDateRangeInput__range-separator` | `<span>`   | Range separator (-)                 | —                                                      |

### Switch

| Class                   | Element   | Targets                       | Data Attrs      |
| ----------------------- | --------- | ----------------------------- | --------------- |
| `.GeckoUISwitch`        | `<label>` | Visual track (the pill shape) | `data-size`     |
| `.GeckoUISwitch__input` | `<input>` | Hidden checkbox (sr-only)     | `role="switch"` |
| `.GeckoUISwitch__thumb` | `<span>`  | Sliding thumb circle          | `data-size`     |

Checked state: use `.GeckoUISwitch:has(input:checked)` selector.

### Checkbox

| Class                      | Element    | Targets                        |
| -------------------------- | ---------- | ------------------------------ |
| `.GeckoUICheckbox`         | `<div>`    | Outer wrapper                  |
| `.GeckoUICheckbox__button` | `<button>` | Clickable area (role=checkbox) |
| `.GeckoUICheckbox__box`    | `<div>`    | The visible checkbox square    |
| `.GeckoUICheckbox__input`  | `<input>`  | Hidden native checkbox         |
| `.GeckoUICheckbox__icon`   | `<svg>`    | Check/indeterminate icon       |

### Radio

| Class           | Element   | Targets                                              |
| --------------- | --------- | ---------------------------------------------------- |
| `.GeckoUIRadio` | `<input>` | The radio input itself (styled with appearance:none) |

### OTPInput

| Class                              | Element    | Targets                      | Data Attrs   |
| ---------------------------------- | ---------- | ---------------------------- | ------------ |
| `.GeckoUIOTPInput`                 | `<div>`    | Grid container               | `data-state` |
| `.GeckoUIOTPInput__input`          | `<input>`  | Individual digit input cell  | —            |
| `.GeckoUIOTPInput__overlay-button` | `<button>` | Overlay for focus management | —            |

### CounterInput

| Class                          | Element    | Targets                    | Data Attrs                |
| ------------------------------ | ---------- | -------------------------- | ------------------------- |
| `.GeckoUICounterInput`         | `<div>`    | Outer flex container       | `data-size`, `data-state` |
| `.GeckoUICounterInput__button` | `<button>` | Increment/decrement button | `data-action`             |
| `.GeckoUICounterInput__icon`   | `<span>`   | Plus/minus icon            | `data-icon`               |
| `.GeckoUICounterInput__input`  | `<input>`  | The number display input   | —                         |

### Pagination

| Class                              | Element    | Targets                       | Data Attrs                     |
| ---------------------------------- | ---------- | ----------------------------- | ------------------------------ |
| `.GeckoUIPagination`               | `<div>`    | Pagination wrapper            | —                              |
| `.GeckoUIPagination__arrow`        | `<button>` | Prev/next arrow button        | —                              |
| `.GeckoUIPagination__arrow__icon`  | `<span>`   | Arrow icon                    | `data-direction`               |
| `.GeckoUIPagination__page-count`   | `<div>`    | "x / y" display               | —                              |
| `.GeckoUIPagination__page-buttons` | `<div>`    | Page number buttons container | —                              |
| `.GeckoUIPagination__page-button`  | `<button>` | Individual page number        | `data-active`, `data-ellipsis` |

### Label / InputError / Spinner

| Class                               | Element   | Targets            |
| ----------------------------------- | --------- | ------------------ |
| `.GeckoUILabel`                     | `<label>` | Label element      |
| `.GeckoUILabel__required-indicator` | `<span>`  | Red asterisk (\*)  |
| `.GeckoUILabel__tooltip-icon`       | `<div>`   | Help/info icon     |
| `.GeckoUIInputError`                | `<div>`   | Error message text |
| `.GeckoUISpinnerIcon`               | `<svg>`   | Animated spinner   |

### RHF Components

RHF classes stack on the **same DOM element** as their base component class (see Class Stacking section above). Styling `.GeckoUIInput` also affects `.GeckoUIRHFInput`.

| Class                                       | Element      | Targets                                  | Data Attrs                                    |
| ------------------------------------------- | ------------ | ---------------------------------------- | --------------------------------------------- |
| `.GeckoUIRHFInput`                          | `<label>`    | Wraps Input                              | `data-error`                                  |
| `.GeckoUIRHFTextarea`                       | `<textarea>` | Wraps Textarea                           | `data-error`                                  |
| `.GeckoUIRHFSelect`                         | `<div>`      | Wraps Select outer container             | —                                             |
| `.GeckoUIRHFSelectButton`                   | `<div>`      | Wraps SelectButton                       | `data-error`                                  |
| `.GeckoUIRHFOTPInput`                       | `<div>`      | Wraps OTPInput                           | `data-error`                                  |
| `.GeckoUIRHFCounterInput`                   | `<div>`      | Wraps CounterInput                       | `data-error`                                  |
| `.GeckoUIRHFSwitch`                         | `<label>`    | Wraps Switch                             | —                                             |
| `.GeckoUIRHFSwitch__thumb`                  | `<span>`     | Switch thumb                             | —                                             |
| `.GeckoUIRHFCheckbox`                       | `<label>`    | Checkbox + label wrapper                 | —                                             |
| `.GeckoUIRHFCheckbox__label`                | `<span>`     | Label text                               | —                                             |
| `.GeckoUIRHFRadio`                          | `<label>`    | Radio + label wrapper                    | —                                             |
| `.GeckoUIRHFRadio__label`                   | `<span>`     | Label text                               | —                                             |
| `.GeckoUIRHFFileInput`                      | `<label>`    | File input wrapper                       | —                                             |
| `.GeckoUIRHFFileInput__input`               | `<input>`    | Hidden file input                        | `data-custom`                                 |
| `.GeckoUIRHFFilePicker`                     | `<div>`      | Drag & drop container                    | `data-loading`, `data-dragging`, `data-error` |
| `.GeckoUIRHFFilePicker__upload-area`        | `<div>`      | Drop zone (dashed border)                | —                                             |
| `.GeckoUIRHFFilePicker__browse-button`      | `<button>`   | Browse files button                      | —                                             |
| `.GeckoUIRHFFilePicker__file-list`          | `<div>`      | Selected files list                      | —                                             |
| `.GeckoUIRHFFilePicker__file-row`           | `<div>`      | Individual file row                      | —                                             |
| `.GeckoUIRHFFilePicker__file-name`          | `<span>`     | File name                                | —                                             |
| `.GeckoUIRHFFilePicker__file-size`          | `<span>`     | File size                                | —                                             |
| `.GeckoUIRHFFilePicker__file-remove`        | `<button>`   | Remove file button                       | —                                             |
| `.GeckoUIRHFFilePicker__file-remove-icon`   | `<svg>`      | Remove icon                              | —                                             |
| `.GeckoUIRHFFilePicker__upload-icon`        | `<svg>`      | Upload icon                              | —                                             |
| `.GeckoUIRHFFilePicker__upload-text`        | `<p>`        | Upload instruction text                  | —                                             |
| `.GeckoUIRHFFilePicker__upload-buttons`     | `<div>`      | Button container                         | —                                             |
| `.GeckoUIRHFFilePicker__loading-overlay`    | `<div>`      | Loading spinner overlay                  | —                                             |
| `.GeckoUIRHFCurrencyInput`                  | `<label>`    | Currency input wrapper                   | —                                             |
| `.GeckoUIRHFCurrencyInput__currency-symbol` | `<span>`     | Currency symbol ($ € £)                  | —                                             |
| `.GeckoUIRHFCurrencyInput__currency-code`   | `<span>`     | Currency code (USD, EUR)                 | —                                             |
| `.GeckoUIRHFError`                          | `<div>`      | Error message                            | —                                             |
| `.GeckoUIRHFInputGroup`                     | `<div>`      | Form field group (label + input + error) | —                                             |
