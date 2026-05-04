import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./styles.css";

ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
