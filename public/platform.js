(function () {
	"use strict";

	const PocketUI = window.PocketUI || {};

	PocketUI.state = {
		density: localStorage.getItem("pocket:density") || "balanced",
		fullScreen: false,
		activeNav: "console",
	};

	function syncViewportHeight() {
		const height = window.visualViewport?.height || window.innerHeight;
		document.documentElement.style.setProperty("--viewport-height", `${Math.round(height)}px`);
	}

	function applyDensity(profile) {
		document.documentElement.dataset.density = profile;
		localStorage.setItem("pocket:density", profile);
		PocketUI.state.density = profile;
	}

	function initViewportController() {
		syncViewportHeight();
		window.visualViewport?.addEventListener("resize", syncViewportHeight, { passive: true });
		window.visualViewport?.addEventListener("scroll", syncViewportHeight, { passive: true });
		window.addEventListener("resize", syncViewportHeight, { passive: true });
	}

	function initOrientationController() {
		const media = window.matchMedia("(orientation: landscape)");
		const handler = () => {
			document.documentElement.dataset.orientation = media.matches ? "landscape" : "portrait";
		};
		handler();
		media.addEventListener("change", handler);
	}

	function initLifecycleController() {
		document.addEventListener("visibilitychange", () => {
			document.documentElement.dataset.visible = String(!document.hidden);
		});
		window.addEventListener("online", () => {
			document.documentElement.dataset.online = "true";
		});
		window.addEventListener("offline", () => {
			document.documentElement.dataset.online = "false";
		});
		document.documentElement.dataset.visible = String(!document.hidden);
		document.documentElement.dataset.online = String(navigator.onLine);
	}

	function initDensity() {
		applyDensity(PocketUI.state.density);
	}

	function showPanel(panelId) {
		const panels = document.querySelectorAll("[data-panel]");
		for (const panel of panels) {
			panel.hidden = panel.getAttribute("id") !== panelId;
		}
		const navBtns = document.querySelectorAll("[data-nav]");
		for (const btn of navBtns) {
			btn.removeAttribute("aria-current");
			if (btn.dataset.nav === panelId) {
				btn.setAttribute("aria-current", "page");
			}
		}
		PocketUI.state.activeNav = panelId;
	}

	function initNavigation() {
		const nav = document.querySelector(".bottom-nav");
		if (!nav) return;
		nav.addEventListener("click", (e) => {
			const btn = e.target.closest("[data-nav]");
			if (!btn) return;
			const target = btn.dataset.nav;
			switch (target) {
				case "console":
				case "terminal":
				case "files":
				case "diagnostics":
				case "settings":
					showPanel(target);
					break;
				case "sessions":
					showPanel(target);
					const sheet = document.getElementById("terminal-sessions-sheet");
					if (sheet && typeof sheet.showModal === "function") {
						sheet.showModal();
						document.getElementById("sheet-backdrop")?.removeAttribute("hidden");
					}
					break;
			}
		});
	}

	function initFullScreen() {
		const toggle = document.getElementById("terminal-fullscreen-toggle");
		if (!toggle) return;
		toggle.addEventListener("click", () => {
			PocketUI.state.fullScreen = !PocketUI.state.fullScreen;
			document.documentElement.dataset.fullscreen = String(PocketUI.state.fullScreen);
			if (PocketUI.state.fullScreen) {
				showPanel("terminal");
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && PocketUI.state.fullScreen) {
				PocketUI.state.fullScreen = false;
				document.documentElement.dataset.fullscreen = "false";
			}
		});
	}

	let lastScrollY = 0;
	let navTimer = null;

	function initAutoHideNav() {
		const nav = document.querySelector(".bottom-nav");
		if (!nav) return;
		const scrollContainer = document.querySelector(".transcript") || document.querySelector(".terminal-viewport");
		if (!scrollContainer) return;
		scrollContainer.addEventListener(
			"scroll",
			() => {
				if (PocketUI.state.fullScreen) {
					nav.classList.remove("nav-hidden");
					return;
				}
				const currentY = scrollContainer.scrollTop;
				if (currentY > lastScrollY && currentY > 60) {
					nav.classList.add("nav-hidden");
				} else {
					nav.classList.remove("nav-hidden");
				}
				lastScrollY = currentY;
				if (navTimer) clearTimeout(navTimer);
				navTimer = setTimeout(() => {
					if (scrollContainer.scrollTop <= 60) nav.classList.remove("nav-hidden");
				}, 1500);
			},
			{ passive: true },
		);
	}

	function haptic(pattern) {
		try {
			if (navigator.vibrate) {
				navigator.vibrate(pattern);
			}
		} catch {}
	}

	PocketUI.viewport = { sync: syncViewportHeight };
	PocketUI.density = { apply: applyDensity, get: () => PocketUI.state.density };
	PocketUI.nav = { show: showPanel, active: () => PocketUI.state.activeNav };
	PocketUI.fullScreen = { isActive: () => PocketUI.state.fullScreen };
	PocketUI.haptic = haptic;

	window.PocketUI = PocketUI;

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			initViewportController();
			initOrientationController();
			initLifecycleController();
			initDensity();
			initNavigation();
			initFullScreen();
			initAutoHideNav();
		});
	} else {
		initViewportController();
		initOrientationController();
		initLifecycleController();
		initDensity();
		initNavigation();
		initFullScreen();
		initAutoHideNav();
	}
})();
