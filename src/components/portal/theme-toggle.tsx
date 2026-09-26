"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sun/moon toggle — flips between light and dark (system default on load).
 * Icon visibility is CSS-driven (`dark:` variant), so there is no mounted
 * state and no hydration mismatch; `resolvedTheme` settles right after mount.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-7 w-7 shrink-0 border-[#d0d7de] text-[#59636e] hover:bg-[#f6f8fa] hover:text-[#1f2328]"
    >
      <Sun className="hidden h-3.5 w-3.5 dark:block" aria-hidden="true" />
      <Moon className="h-3.5 w-3.5 dark:hidden" aria-hidden="true" />
    </Button>
  );
}
