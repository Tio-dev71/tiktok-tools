import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import RenderWorker from "./RenderWorker";
import "./index.css";

const path = window.location.pathname;

createRoot(document.getElementById("root")!).render(
  path === "/render-worker" ? <RenderWorker /> : <App />
);