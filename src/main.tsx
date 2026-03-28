import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MidiProvider } from "./MidiContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MidiProvider>
      <App />
    </MidiProvider>
  </React.StrictMode>,
);
