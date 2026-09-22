import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchApp } from "./ui/WorkbenchApp";
import { recentStore, runtimeConfig, workbenchService } from "./config/runtime";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <WorkbenchApp service={workbenchService} recentStore={recentStore} config={runtimeConfig} />
  </StrictMode>,
);
