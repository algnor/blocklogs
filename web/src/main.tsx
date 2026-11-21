import "@aomc-server/block-ui/css";
import { initToggleDrag, installFontScale } from "@aomc-server/block-ui";
import { render } from "preact";
import { App } from "./App";
import { startLive } from "./live";
import { followAppearance } from "./settings";
import "./styles.css";

initToggleDrag();
installFontScale();
followAppearance();
startLive();
const root = document.getElementById("app");
if (root) render(<App />, root);
