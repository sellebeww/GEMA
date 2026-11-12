// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  test: { include: ["tests/**/*.test.ts"] },
});
