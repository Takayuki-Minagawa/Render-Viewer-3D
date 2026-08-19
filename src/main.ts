import "./styles.css";
import { createApplication } from "./app/create-application";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root element was not found.");

const application = createApplication(root);
if (import.meta.hot) {
  import.meta.hot.dispose(() => application.dispose());
}
