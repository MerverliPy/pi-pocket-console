(() => {
	const TERMINAL_CONTAINER_ID = "terminal-viewport";
	const TERMINAL_HEADER_ID = "terminal-header";
	const CONNECTION_INDICATOR_ID = "terminal-connection-indicator";
	const TERMINAL_SESSION_LIST_ID = "terminal-session-list";
	const GRACEFUL_TERMINATE_ID = "terminal-terminate-graceful";
	const FORCE_TERMINATE_ID = "terminal-terminate-force";
	const EMERGENCY_TERMINATE_ID = "terminal-emergency-terminate";
	const RECONNECT_BUTTON_ID = "terminal-reconnect";

	const MESSAGE_TYPES = {
		CONNECTION_READY: "connection.ready",
		CONNECTION_ERROR: "connection.error",
		CONNECTION_PING: "connection.ping",
		CONNECTION_PONG: "connection.pong",
		CLIENT_HELLO: "client.hello",
		TERMINAL_ATTACH: "terminal.attach",
		TERMINAL_ATTACHED: "terminal.attached",
		TERMINAL_DETACH: "terminal.detach",
		TERMINAL_INPUT: "terminal.input",
		TERMINAL_INPUT_ACCEPTED: "terminal.input.accepted",
		TERMINAL_INPUT_REJECTED: "terminal.input.rejected",
		TERMINAL_OUTPUT: "terminal.output",
		TERMINAL_RESIZE: "terminal.resize",
		TERMINAL_RESIZE_ACCEPTED: "terminal.resize.accepted",
		TERMINAL_REPLAY_BEGIN: "terminal.replay.begin",
		TERMINAL_REPLAY_END: "terminal.replay.end",
		TERMINAL_REPLAY_ACK: "terminal.replay.ack",
		TERMINAL_REPLAY_GAP: "terminal.replay.gap",
		LEASE_GRANTED: "lease.granted",
		LEASE_REVOKED: "lease.revoked",
		LEASE_EXPIRING: "lease.expiring",
		LEASE_CHANGED: "lease.changed",
		TERMINAL_STATE: "terminal.state",
		TERMINAL_PROCESS_EXIT: "terminal.process.exit",
		TERMINAL_WARNING: "terminal.warning",
		TERMINAL_FAILURE: "terminal.failure",
	};

	const TERMINAL_STATES = {
		CREATING: { label: "Starting", css: "state-creating" },
		RUNNING: { label: "Connected", css: "state-running" },
		DETACHED: { label: "Disconnected", css: "state-detached" },
		RECONNECTING: { label: "Reconnecting", css: "state-reconnecting" },
		TERMINATING: { label: "Ending", css: "state-terminating" },
		TERMINATED: { label: "Ended", css: "state-terminated" },
		EXPIRED: { label: "Expired", css: "state-expired" },
		FAILED: { label: "Failed", css: "state-failed" },
	};

	const GRAPHITE_THEME = {
		foreground: "#edf7f8",
		background: "#080b0e",
		cursor: "#63e6df",
		cursorAccent: "#080b0e",
		selectionBackground: "rgba(99, 230, 223, 0.25)",
		black: "#1a1a2e",
		red: "#ff817d",
		green: "#6ae2a0",
		yellow: "#ffc66d",
		blue: "#83b9ff",
		magenta: "#d4a0ff",
		cyan: "#63e6df",
		white: "#edf7f8",
		brightBlack: "#66777c",
		brightRed: "#ff817d",
		brightGreen: "#6ae2a0",
		brightYellow: "#ffc66d",
		brightBlue: "#83b9ff",
		brightMagenta: "#d4a0ff",
		brightCyan: "#63e6df",
		brightWhite: "#edf7f8",
	};

	let terminalInstance = null;
	let fitAddon = null;
	let webglAddon = null;
	let ws = null;
	let currentSessionId = null;
	let currentLease = null;
	let leaseGeneration = 0;
	let _currentState = null;
	let lastReceivedSequence = -1;
	let pendingInput = false;
	let reconnectTimer = null;
	let pingInterval = null;
	let heartbeatInterval = 15000;
	let _connectionId = null;
	let reconnectAttempts = 0;
	const MAX_RECONNECT_ATTEMPTS = 3;

	const byId = (id) => document.getElementById(id);

	function connectWebSocket(sessionId, csrfToken) {
		if (ws && ws.readyState === WebSocket.OPEN) return;
		const protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${location.host}/api/v1/ws`;

		ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";

		ws.onopen = () => {
			currentSessionId = sessionId;
			updateConnectionStatus("connected");
			sendEnvelope({
				type: MESSAGE_TYPES.CLIENT_HELLO,
				payload: {
					clientName: "pi-pocket-console-web",
					clientVersion: "0.2.0",
					supportedProtocolVersions: [1],
					platform: "ios-pwa",
				},
			});
		};

		ws.onmessage = (event) => {
			try {
				const envelope = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data));
				handleEnvelope(envelope, csrfToken);
			} catch (err) {
				console.warn("Failed to parse WebSocket message:", err);
			}
		};

		ws.onclose = () => {
			updateConnectionStatus("disconnected");
			stopPingInterval();
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				reconnectAttempts++;
				reconnectTimer = setTimeout(() => connectWebSocket(sessionId, csrfToken), 2000 * reconnectAttempts);
			} else {
				showReconnectButton();
			}
		};

		ws.onerror = () => {
			updateConnectionStatus("error");
		};
	}

	function sendEnvelope(envelope) {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		const message = JSON.stringify({ version: 1, ...envelope, requestId: crypto.randomUUID() });
		ws.send(message);
	}

	function handleEnvelope(envelope, _csrfToken) {
		const { type, payload } = envelope;

		switch (type) {
			case MESSAGE_TYPES.CONNECTION_READY:
				_connectionId = payload.connectionId;
				heartbeatInterval = payload.heartbeatIntervalMs || 15000;
				sendEnvelope({ type: MESSAGE_TYPES.TERMINAL_ATTACH, payload: { lastReceivedSequence } });
				startPingInterval();
				break;

			case MESSAGE_TYPES.TERMINAL_ATTACHED:
				updateTerminalState(payload.state);
				updateLeaseInfo(payload.lease);
				if (payload.replay.available && payload.replay.latestSequence !== undefined) {
					replayOutput(payload.replay);
				}
				break;

			case MESSAGE_TYPES.TERMINAL_OUTPUT:
				if (terminalInstance) {
					terminalInstance.write(payload.data);
				}
				lastReceivedSequence = envelope.sequence;
				break;

			case MESSAGE_TYPES.TERMINAL_REPLAY_BEGIN:
				showReplayStatus("Replaying session output\u2026");
				break;

			case MESSAGE_TYPES.TERMINAL_REPLAY_END:
				hideReplayStatus();
				sendEnvelope({ type: MESSAGE_TYPES.TERMINAL_REPLAY_ACK, payload: { lastReceivedSequence } });
				break;

			case MESSAGE_TYPES.TERMINAL_REPLAY_GAP:
				showReplayStatus("Some output was lost before reconnection.");
				break;

			case MESSAGE_TYPES.CONNECTION_PING:
				sendEnvelope({
					type: MESSAGE_TYPES.CONNECTION_PONG,
					payload: { sentAt: payload.sentAt, receivedAt: new Date().toISOString() },
				});
				break;

			case MESSAGE_TYPES.TERMINAL_STATE:
				updateTerminalState(payload.state);
				if (payload.state === "TERMINATED" || payload.state === "FAILED" || payload.state === "EXPIRED") {
					cleanupTerminal();
				}
				break;

			case MESSAGE_TYPES.TERMINAL_PROCESS_EXIT:
				showToast(`Process exited (code: ${payload.exitCode})`);
				break;

			case MESSAGE_TYPES.TERMINAL_WARNING:
				showToast(payload.message, "warning");
				break;

			case MESSAGE_TYPES.TERMINAL_FAILURE:
				showToast(payload.error.message, "error");
				cleanupTerminal();
				break;

			case MESSAGE_TYPES.LEASE_GRANTED:
				currentLease = payload.lease;
				leaseGeneration = payload.lease.generation;
				updateLeaseInfo({ state: "owned", generation: payload.lease.generation, expiresAt: payload.lease.expiresAt });
				break;

			case MESSAGE_TYPES.LEASE_REVOKED:
				currentLease = null;
				updateLeaseInfo({ state: "none" });
				break;

			case MESSAGE_TYPES.LEASE_CHANGED:
				updateLeaseInfo(payload.state);
				break;

			case MESSAGE_TYPES.TERMINAL_INPUT_ACCEPTED:
				pendingInput = false;
				break;

			case MESSAGE_TYPES.TERMINAL_INPUT_REJECTED:
				pendingInput = false;
				showToast(`Input rejected: ${payload.error?.message || "lease may have expired"}`, "error");
				break;

			case MESSAGE_TYPES.TERMINAL_RESIZE_ACCEPTED:
				break;

			case MESSAGE_TYPES.CONNECTION_ERROR:
				showToast(payload.error?.message || "Connection error", "error");
				break;
		}
	}

	function startPingInterval() {
		stopPingInterval();
		pingInterval = setInterval(() => {
			sendEnvelope({ type: MESSAGE_TYPES.CONNECTION_PING, payload: { sentAt: new Date().toISOString() } });
		}, heartbeatInterval);
	}

	function stopPingInterval() {
		if (pingInterval) {
			clearInterval(pingInterval);
			pingInterval = null;
		}
	}

	function updateTerminalState(state) {
		_currentState = state;
		const info = TERMINAL_STATES[state] || { label: state, css: "" };
		const header = byId(TERMINAL_HEADER_ID);
		if (header) {
			const stateEl = header.querySelector(".terminal-state-value");
			if (stateEl) {
				stateEl.textContent = info.label;
				stateEl.className = `terminal-state-value ${info.css}`;
			}
		}
		const actions = document.getElementById("terminal-actions");
		if (actions) {
			actions.style.display = state === "RUNNING" ? "flex" : "none";
		}
		const reconnectBtn = byId(RECONNECT_BUTTON_ID);
		if (reconnectBtn) {
			reconnectBtn.style.display = state === "DETACHED" ? "block" : "none";
		}
	}

	function updateLeaseInfo(summary) {
		const el = byId(CONNECTION_INDICATOR_ID);
		if (!el) return;
		if (summary.state === "owned") {
			el.textContent = "Lease acquired";
			el.className = "connection-indicator lease-owned";
		} else if (summary.state === "owned-by-other-device") {
			el.textContent = "Controlled by another device";
			el.className = "connection-indicator lease-other";
		} else {
			el.textContent = "No lease";
			el.className = "connection-indicator lease-none";
		}
	}

	function updateConnectionStatus(status) {
		const el = byId(CONNECTION_INDICATOR_ID);
		if (!el) return;
		switch (status) {
			case "connected":
				el.textContent = "WebSocket connected";
				el.className = "connection-indicator transport-connected";
				break;
			case "disconnected":
				el.textContent = "Disconnected";
				el.className = "connection-indicator transport-disconnected";
				break;
			case "error":
				el.textContent = "Connection error";
				el.className = "connection-indicator transport-error";
				break;
		}
	}

	function showReplayStatus(msg) {
		const el = byId("terminal-replay-status");
		if (el) {
			el.textContent = msg;
			el.hidden = false;
		}
	}

	function hideReplayStatus() {
		const el = byId("terminal-replay-status");
		if (el) el.hidden = true;
	}

	function replayOutput(replayInfo) {
		if (!replayInfo.available) return;
	}

	function showToast(msg, kind) {
		const stack =
			document.querySelector(".toast-stack") ||
			(() => {
				const s = document.createElement("div");
				s.className = "toast-stack";
				s.setAttribute("aria-live", "polite");
				document.body.append(s);
				return s;
			})();
		const item = document.createElement("div");
		item.className = "toast";
		item.dataset.kind = kind || "info";
		item.textContent = msg;
		stack.append(item);
		setTimeout(() => item.remove(), 4200);
	}

	function showReconnectButton() {
		const btn = byId(RECONNECT_BUTTON_ID);
		if (btn) btn.hidden = false;
	}

	function cleanupTerminal() {
		if (terminalInstance) {
			try {
				terminalInstance.dispose();
			} catch (_e) {
				/* ok */
			}
			terminalInstance = null;
			fitAddon = null;
			webglAddon = null;
		}
		if (ws) {
			try {
				ws.close();
			} catch (_e) {
				/* ok */
			}
			ws = null;
		}
		stopPingInterval();
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		currentLease = null;
		currentSessionId = null;
		pendingInput = false;
	}

	function initTerminal(container) {
		if (terminalInstance) return;
		if (typeof Terminal === "undefined" || typeof FitAddon === "undefined") {
			showToast("Terminal library not loaded", "error");
			return;
		}
		try {
			terminalInstance = new Terminal({
				cols: 80,
				rows: 24,
				cursorStyle: "block",
				cursorBlink: true,
				fontFamily: '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
				fontSize: 13,
				lineHeight: 1.35,
				theme: GRAPHITE_THEME,
				allowTransparency: false,
				disableStdin: false,
				scrollback: 5000,
				screenReaderMode: true,
			});

			fitAddon = new FitAddon();
			terminalInstance.loadAddon(fitAddon);

			try {
				webglAddon = new WebglAddon();
				terminalInstance.loadAddon(webglAddon);
			} catch {
				// WebGL not available, fall back to canvas renderer
			}

			container.innerHTML = "";
			terminalInstance.open(container);
			setTimeout(() => fitAddon.fit(), 50);

			terminalInstance.onResize(({ cols, rows }) => {
				if (currentLease) {
					sendEnvelope({
						type: MESSAGE_TYPES.TERMINAL_RESIZE,
						payload: {
							leaseId: currentLease.leaseId,
							leaseGeneration: currentLease.generation,
							cols,
							rows,
						},
					});
				}
			});

			terminalInstance.onData((data) => {
				if (!currentLease || pendingInput) return;
				pendingInput = true;
				sendEnvelope({
					type: MESSAGE_TYPES.TERMINAL_INPUT,
					payload: {
						leaseId: currentLease.leaseId,
						leaseGeneration: currentLease.generation,
						data,
					},
				});
			});

			window.addEventListener("resize", () => {
				if (fitAddon) {
					setTimeout(() => fitAddon.fit(), 250);
				}
			});
		} catch (err) {
			showToast(`Failed to initialize terminal: ${err.message}`, "error");
		}
	}

	function getLease(sessionId, csrfToken) {
		return fetch(`/api/v1/terminals/${sessionId}/lease/acquire`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-Token": csrfToken,
			},
			body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
		}).then((r) => r.json());
	}

	function releaseLease(sessionId, csrfToken) {
		if (!currentLease) return Promise.resolve();
		return fetch(`/api/v1/terminals/${sessionId}/lease/release`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-Token": csrfToken,
			},
			body: JSON.stringify({ expectedGeneration: leaseGeneration, clientRequestId: crypto.randomUUID() }),
		}).then((r) => r.json());
	}

	function terminateSession(sessionId, mode, csrfToken) {
		return fetch(`/api/v1/terminals/${sessionId}/terminate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-Token": csrfToken,
			},
			body: JSON.stringify({ mode, clientRequestId: crypto.randomUUID() }),
		}).then((r) => r.json());
	}

	function loadSessionList(csrfToken) {
		return fetch("/api/v1/terminals", {
			headers: { "X-CSRF-Token": csrfToken },
		})
			.then((r) => r.json())
			.then((result) => {
				const list = byId(TERMINAL_SESSION_LIST_ID);
				if (!list) return;
				const sessions = result.data?.terminals || [];
				if (sessions.length === 0) {
					list.innerHTML = '<p class="empty-sessions">No terminal sessions.</p>';
					return;
				}
				list.innerHTML = sessions
					.map(
						(s) => `
				<button class="session-item" data-session-id="${s.sessionId}" data-state="${s.state}">
					<span class="session-state-dot ${TERMINAL_STATES[s.state]?.css || ""}"></span>
					<span class="session-label">${s.launcherId}</span>
					<small class="session-meta">${s.state} \u00B7 ${new Date(s.createdAt).toLocaleTimeString()}</small>
				</button>
			`,
					)
					.join("");
			});
	}

	window.TerminalUI = {
		init(csrfToken) {
			const container = byId(TERMINAL_CONTAINER_ID);
			if (!container) return;
			initTerminal(container);
			loadSessionList(csrfToken);

			const gracefulBtn = byId(GRACEFUL_TERMINATE_ID);
			const forceBtn = byId(FORCE_TERMINATE_ID);
			const emergencyBtn = byId(EMERGENCY_TERMINATE_ID);
			const reconnectBtn = byId(RECONNECT_BUTTON_ID);

			if (gracefulBtn) {
				gracefulBtn.addEventListener("click", () => {
					if (!currentSessionId) return;
					if (confirm("Terminate this terminal session?")) {
						terminateSession(currentSessionId, "graceful", csrfToken).then(() => {
							showToast("Session terminating\u2026");
							cleanupTerminal();
						});
					}
				});
			}

			if (forceBtn) {
				forceBtn.addEventListener("click", () => {
					if (!currentSessionId) return;
					if (confirm("Force terminate? This may leave processes running on the host.")) {
						terminateSession(currentSessionId, "force", csrfToken).then(() => {
							showToast("Force termination requested");
							cleanupTerminal();
						});
					}
				});
			}

			if (emergencyBtn) {
				emergencyBtn.addEventListener("click", () => {
					if (!currentSessionId) return;
					if (confirm("Emergency termination will immediately kill the process tree. Continue?")) {
						terminateSession(currentSessionId, "force", csrfToken).then(() => {
							showToast("Emergency termination triggered");
							cleanupTerminal();
						});
					}
				});
			}

			if (reconnectBtn) {
				reconnectBtn.addEventListener("click", () => {
					if (currentSessionId) {
						reconnectAttempts = 0;
						connectWebSocket(currentSessionId, csrfToken);
						reconnectBtn.hidden = true;
					}
				});
			}
		},

		attach(sessionId, csrfToken) {
			getLease(sessionId, csrfToken).then((result) => {
				if (result.ok) {
					currentLease = result.data.lease;
					leaseGeneration = result.data.lease.generation;
					connectWebSocket(sessionId, csrfToken);
				} else {
					showToast(`Failed to acquire lease: ${result.error?.message || "unknown"}`, "error");
				}
			});
		},

		detach(csrfToken) {
			if (currentSessionId) {
				sendEnvelope({ type: MESSAGE_TYPES.TERMINAL_DETACH, payload: { reason: "manual" } });
				releaseLease(currentSessionId, csrfToken);
			}
			cleanupTerminal();
		},

		refreshSessions(csrfToken) {
			loadSessionList(csrfToken);
		},
	};
})();
