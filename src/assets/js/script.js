import { _event } from "./utils/_event";
import { _converterUI } from "./utils/_converter-ui";
import { _background } from "./utils/_background";

// matches --color-theme-bg in style.css
const THEME_COLORS = { dark: "#0c0c0e", light: "#f5f4ef" };

class _projName {
    constructor(props) {
        if (window._projName) return;
        window._projName = this;

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
        // for resize
        _event.resize(() => this.resize());

        document.querySelectorAll("[data-converter]").forEach((root) => new _converterUI(root));
        document.querySelectorAll("[data-background]").forEach((canvas) => new _background(canvas));
        document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", () => this.toggleTheme()));

        if (this.debug) console.log("_projName", this);
    }

    // the inline script in base.njk reads the same key before paint
    toggleTheme() {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        document.documentElement.dataset.theme = next;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[next]);

        try {
            localStorage.setItem("theme", next);
        } catch (e) {
            // storage blocked, still switches for this visit
        }
    }

    resize() {
        this.headerHeight = this.el.header?.offsetHeight ?? 0;
        document.body.style.setProperty("--header-height", `${this.headerHeight}px`);

        this.footerHeight = this.el.footer?.offsetHeight ?? 0;
        document.body.style.setProperty("--footer-height", `${this.footerHeight}px`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new _projName({ debug: false });
});
