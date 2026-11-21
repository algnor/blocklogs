import { render } from "preact";
import { App } from "./App";
import { startLive } from "./live";
import "./styles.css";

startLive();
const root = document.getElementById("app");
if (root) render(<App />, root);
