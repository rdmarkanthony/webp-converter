import { _event } from "./utils/_event";
import { _converterUI } from "./utils/_converter-ui";
import { _background } from "./utils/_background";

const THEME_COLORS = { dark: "#0c0c0e", light: "#ffffff" };

class _webpConverterApp {
    constructor(props) {
        if (window._webpConverterApp) return;
        window._webpConverterApp = this;

        this.debug = props.debug || false;

        this.el = {
            header: document.querySelector(".header-content"),
            footer: document.querySelector(".footer-content"),
            main: document.querySelector(".main-content"),
        };

        this.headerHeight = 0;
        this.footerHeight = 0;

        this.init();
    }

    init() {
        _event.resize(() => this.resize());

        document.querySelectorAll("[data-converter]").forEach((root) => new _converterUI(root));
        document.querySelectorAll("[data-background]").forEach((canvas) => new _background(canvas));
        document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", () => this.toggleTheme()));

        if (this.debug) console.log("_webpConverterApp", this);
    }

    toggleTheme() {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        document.documentElement.dataset.theme = next;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[next]);

        try {
            localStorage.setItem("theme", next);
        } catch (e) {}
    }

    resize() {
        this.headerHeight = this.el.header?.offsetHeight ?? 0;
        document.body.style.setProperty("--header-height", `${this.headerHeight}px`);

        this.footerHeight = this.el.footer?.offsetHeight ?? 0;
        document.body.style.setProperty("--footer-height", `${this.footerHeight}px`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new _webpConverterApp({ debug: false });
});
