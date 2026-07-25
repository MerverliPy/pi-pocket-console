const CACHE_PREFIX = "pi-pocket-shell";
const CACHE_NAME = `${CACHE_PREFIX}-v3`;

const SHELL_PATHS = new Set([
	"/",
	"/index.html",
	"/offline.html",
	"/app.css",
	"/app.js",
	"/platform.js",
	"/terminal.js",
	"/xterm.css",
	"/xterm.js",
	"/manifest.webmanifest",
	"/icon.svg",
	"/icon-192.png",
	"/icon-512.png",
	"/apple-touch-icon.png",
]);

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll([...SHELL_PATHS]))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") {
		return;
	}

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) {
		return;
	}

	if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
		return;
	}

	if (SHELL_PATHS.has(url.pathname)) {
		event.respondWith(
			caches.open(CACHE_NAME).then(async (cache) => {
				const cached = await cache.match(request, { ignoreSearch: true });
				const fetchPromise = fetch(request)
					.then((response) => {
						if (response.ok) {
							cache.put(request, response.clone());
						}
						return response;
					})
					.catch(() => cached);
				return cached || fetchPromise;
			}),
		);
		return;
	}

	if (request.mode === "navigate") {
		event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
	}
});
