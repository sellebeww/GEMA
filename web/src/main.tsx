// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root tidak ada");
createRoot(root).render(<App />);
