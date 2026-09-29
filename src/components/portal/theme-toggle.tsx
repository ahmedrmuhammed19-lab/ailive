"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sun/moon toggle — flips between light and dark (system default on load).
 * Icon visibility is CSS-driven (`dark:` variant). The accessible label is
 * deliberately STATIC: `resolvedTheme` is undefined during SSR but set on the
 * client, so branching on it would cause a hydration mismatch for every
 * visitor with a persisted theme. The icon already communicates the state.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle color theme"
      title="Toggle color theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-7 w-7 shrink-0 border-[var(--eis-border)] text-[var(--eis-muted)] hover:bg-[var(--eis-canvas-subtle)] hover:text-[var(--eis-fg)]"
    >
      <Sun className="hidden h-3.5 w-3.5 dark:block" aria-hidden="true" />
      <Moon className="h-3.5 w-3.5 dark:hidden" aria-hidden="true" />
    </Button>
  );
}
