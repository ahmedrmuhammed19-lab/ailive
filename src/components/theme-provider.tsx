"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** App-wide class-based theming (light / dark / system). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
