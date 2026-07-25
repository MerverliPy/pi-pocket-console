const byId = (id) => document.getElementById(id);
const elements = {
	abortButton: byId("abort-button"),
	announcer: byId("announcer"),
	appShell: byId("app-shell"),
	attachmentRail: byId("attachment-rail"),
	commandList: byId("command-list"),
	commandSearch: byId("command-search"),
	commandsButton: byId("commands-button"),
	composer: byId("composer-input"),
	connectionLabel: byId("connection-label"),
	connectionOrb: byId("connection-orb"),
	emptyState: byId("empty-state"),
	extensionDialog: byId("extension-dialog"),
	extensionFields: byId("extension-fields"),
	extensionForm: byId("extension-form"),
	extensionMessage: byId("extension-message"),
	extensionSubmit: byId("extension-submit"),
	extensionTitle: byId("extension-title"),
	imageInput: byId("image-input"),
	installButton: byId("install-button"),
	instanceButton: byId("instance-button"),
	instanceCwd: byId("instance-cwd"),
	instanceLabel: byId("instance-label"),
	instanceList: byId("instance-list"),
	jumpLatest: byId("jump-latest"),
	modeStrip: byId("mode-strip"),
	modelButton: byId("model-button"),
	modelLabel: byId("model-label"),
	modelList: byId("model-list"),
	offlineBanner: byId("offline-banner"),
	pairCode: byId("pair-code"),
	pairError: byId("pair-error"),
	pairForm: byId("pair-form"),
	pairScreen: byId("pair-screen"),
	pairSubmit: byId("pair-submit"),
	queueCount: byId("queue-count"),
	sendButton: byId("send-button"),
	sessionName: byId("session-name"),
	sessionState: byId("session-state"),
	sheetBackdrop: byId("sheet-backdrop"),
	shellNotice: byId("shell-notice"),
	spawnForm: byId("spawn-form"),
	spawnLabel: byId("spawn-cwd"),
	spawnWorkspace: byId("spawn-workspace"),
	thinkingButton: byId("thinking-button"),
	thinkingLabel: byId("thinking-label"),
	thinkingList: byId("thinking-list"),
	transcript: byId("transcript"),
	widgetAbove: byId("extension-widget-above"),
	widgetBelow: byId("extension-widget-below"),
};

const state = {
	activeId: localStorage.getItem("pi-pocket:active-instance") || "",
	attachments: [],
	bashRunning: false,
	commands: [],
	csrfToken: "",
	deferredInstall: null,
	eventSource: null,
	extensionRequest: null,
	extensionTimer: null,
	instances: [],
	isStreaming: false,
	mode: "prompt",
	model: null,
	models: [],
	seenResponses: new Set(),
	thinkingLevel: "off",
	thinkingLevels: [],
	toolCards: new Map(),
	workspace: "",
};

let streamingMessage = null;
let streamingText = "";
let activeBashCard = null;
let modelRefreshPromise = null;

function announce(message) {
	elements.announcer.textContent = "";
	window.setTimeout(() => {
		elements.announcer.textContent = message;
	}, 30);
}

function toast(message, kind = "info", duration = 4200) {
	let stack = document.querySelector(".toast-stack");
	if (!stack) {
		stack = document.createElement("div");
		stack.className = "toast-stack";
		stack.setAttribute("aria-live", "polite");
		document.body.append(stack);
	}
	const item = document.createElement("div");
	item.className = "toast";
	item.dataset.kind = kind;
	item.setAttribute("role", kind === "error" ? "alert" : "status");
	item.textContent = message;
	stack.append(item);
	window.setTimeout(() => item.remove(), duration);
}

function setConnection(connectionState, label) {
	elements.connectionOrb.dataset.state = connectionState;
	elements.connectionLabel.dataset.state = connectionState;
	elements.connectionLabel.textContent = label;
	const disconnected = connectionState === "offline" || connectionState === "error";
	elements.offlineBanner.hidden = !disconnected;
}

function showPairing() {
	state.eventSource?.close();
	state.eventSource = null;
	elements.appShell.hidden = true;
	elements.pairScreen.hidden = false;
	byId("step-1-connection").hidden = false;
	byId("step-2-pair").hidden = true;
	byId("step-3-confirm").hidden = true;
}

function showPairStep(step) {
	byId("step-1-connection").hidden = step !== 1;
	byId("step-2-pair").hidden = step !== 2;
	byId("step-3-confirm").hidden = step !== 3;
	if (step === 2) {
		elements.pairCode.focus({ preventScroll: true });
	}
}

function showApplication() {
	elements.pairScreen.hidden = true;
	elements.appShell.hidden = false;
	syncViewportHeight();
}

async function api(path, options = {}) {
	const request = { credentials: "same-origin", ...options };
	const headers = new Headers(options.headers || {});
	headers.set("Accept", "application/json");
	if (options.body !== undefined) {
		headers.set("Content-Type", "application/json");
		request.body = JSON.stringify(options.body);
	}
	if ((options.method || "GET") !== "GET" && state.csrfToken) {
		headers.set("X-CSRF-Token", state.csrfToken);
	}
	request.headers = headers;

	let response;
	try {
		response = await fetch(path, request);
	} catch {
		setConnection("offline", "Offline");
		throw new Error("The host is unreachable. Your draft is still on this iPhone.");
	}

	let payload = {};
	try {
		payload = await response.json();
	} catch {
		payload = {};
	}
	if (response.status === 401) {
		state.csrfToken = "";
		showPairing();
		throw new Error("This device session has expired. Pair again.");
	}
	if (!response.ok) {
		const error = new Error(payload.error || `Request failed (${response.status})`);
		error.status = response.status;
		error.code = payload.code;
		throw error;
	}
	return payload;
}

function formatPairCode(value) {
	const digits = value.replace(/\D/g, "").slice(0, 6);
	return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

async function pair(event) {
	event.preventDefault();
	const code = elements.pairCode.value.replace(/\D/g, "");
	if (code.length !== 6) {
		elements.pairError.textContent = "Enter all six digits.";
		return;
	}
	elements.pairError.textContent = "";
	elements.pairSubmit.disabled = true;
	try {
		const result = await api("/api/pair", { method: "POST", body: { code } });
		state.csrfToken = result.csrfToken;
		showPairStep(3);
		announce("Pairing code accepted. Confirm this device.");
	} catch (error) {
		elements.pairError.textContent = error.message;
	} finally {
		elements.pairSubmit.disabled = false;
	}
}

async function bootstrap() {
	try {
		const data = await api("/api/bootstrap");
		state.csrfToken = data.csrfToken;
		state.instances = data.instances || [];
		state.workspace = data.workspaceRoot || "";
		elements.spawnWorkspace.textContent = state.workspace;
		elements.spawnWorkspace.title = state.workspace;
		showApplication();
		renderInstances();

		const saved = state.instances.find((instance) => instance.id === state.activeId && instance.status !== "stopped");
		const online = state.instances.find((instance) => instance.status === "online");
		if (saved || online) {
			await activateInstance((saved || online).id);
		} else {
			renderNoInstance();
			openSheet(byId("instance-sheet"));
		}
	} catch (error) {
		if (error.status !== 401) {
			toast(error.message, "error");
		}
	}
}

function renderNoInstance() {
	state.activeId = "";
	localStorage.removeItem("pi-pocket:active-instance");
	elements.instanceLabel.textContent = "Choose an agent";
	elements.instanceCwd.textContent = state.workspace || "No active instance";
	elements.sessionState.textContent = "Idle";
	elements.sessionName.textContent = "Start an agent to begin";
	elements.modelLabel.textContent = "—";
	elements.thinkingLabel.textContent = "—";
	setConnection("connecting", "Idle");
	updateComposer();
}

function instanceName(instance) {
	return instance.label?.trim() || `Agent ${instance.id.slice(0, 6)}`;
}

function renderInstances() {
	elements.instanceList.replaceChildren();
	if (!state.instances.length) {
		const empty = document.createElement("p");
		empty.className = "empty-list";
		empty.textContent = "No host agents are running yet.";
		elements.instanceList.append(empty);
		return;
	}

	for (const instance of state.instances) {
		const card = document.createElement("div");
		card.className = "instance-card";
		card.dataset.selected = String(instance.id === state.activeId);
		card.setAttribute("role", "button");
		card.tabIndex = 0;
		card.setAttribute("aria-label", `Open ${instanceName(instance)}, ${instance.status}`);

		const status = document.createElement("span");
		status.className = "instance-status";
		status.dataset.status = instance.status;
		status.setAttribute("aria-hidden", "true");

		const meta = document.createElement("span");
		meta.className = "instance-meta";
		const title = document.createElement("strong");
		title.textContent = instanceName(instance);
		const detail = document.createElement("small");
		detail.textContent = `${instance.status} · ${instance.cwd}`;
		meta.append(title, detail);

		const action = document.createElement("button");
		action.className = "instance-action";
		action.type = "button";
		action.textContent = instance.status === "stopped" ? "Ended" : "Stop";
		action.disabled = instance.status === "stopped" || instance.status === "stopping";
		action.setAttribute("aria-label", `Stop ${instanceName(instance)}`);
		action.addEventListener("click", (event) => {
			event.stopPropagation();
			void stopInstance(instance.id);
		});

		const select = () => {
			if (instance.status !== "stopped") {
				void activateInstance(instance.id);
				closeSheets();
			}
		};
		card.addEventListener("click", select);
		card.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				select();
			}
		});
		card.append(status, meta, action);
		elements.instanceList.append(card);
	}
}

async function spawnInstance(event) {
	event.preventDefault();
	const label = elements.spawnLabel.value.trim();
	const submit = elements.spawnForm.querySelector("button[type=submit]");
	submit.disabled = true;
	try {
		const data = await api("/api/instances", {
			method: "POST",
			body: label ? { label } : {},
		});
		state.instances = state.instances.filter((item) => item.id !== data.instance.id);
		state.instances.push(data.instance);
		elements.spawnLabel.value = "";
		renderInstances();
		await activateInstance(data.instance.id);
		closeSheets();
		announce(`${instanceName(data.instance)} started.`);
	} catch (error) {
		toast(error.message, "error");
	} finally {
		submit.disabled = false;
	}
}

async function stopInstance(instanceId) {
	const instance = state.instances.find((item) => item.id === instanceId);
	if (!instance || !window.confirm(`Stop ${instanceName(instance)}? Its live process will end.`)) {
		return;
	}
	try {
		const data = await api(`/api/instances/${encodeURIComponent(instanceId)}/stop`, {
			method: "POST",
			body: {},
		});
		state.instances = state.instances.map((item) => (item.id === instanceId ? data.instance : item));
		if (state.activeId === instanceId) {
			state.eventSource?.close();
			state.eventSource = null;
			renderNoInstance();
		}
		renderInstances();
		announce(`${instanceName(instance)} stopped.`);
	} catch (error) {
		toast(error.message, "error");
	}
}

function draftKey(instanceId = state.activeId) {
	return `pi-pocket:draft:${instanceId || "unbound"}`;
}

function saveDraft() {
	localStorage.setItem(draftKey(), elements.composer.value);
}

function loadDraft() {
	elements.composer.value = localStorage.getItem(draftKey()) || "";
	autoSizeComposer();
	updateComposer();
}

async function activateInstance(instanceId) {
	if (!instanceId) {
		return;
	}
	if (state.activeId && state.activeId !== instanceId) {
		saveDraft();
	}
	const instance = state.instances.find((item) => item.id === instanceId);
	if (!instance) {
		return;
	}
	state.activeId = instanceId;
	localStorage.setItem("pi-pocket:active-instance", instanceId);
	elements.instanceLabel.textContent = instanceName(instance);
	elements.instanceCwd.textContent = instance.cwd;
	elements.instanceCwd.title = instance.cwd;
	renderInstances();
	loadDraft();
	clearTranscript();
	connectEvents();
	await refreshInstance();
}

function connectEvents() {
	state.eventSource?.close();
	if (!state.activeId) {
		return;
	}
	setConnection("connecting", "Connecting");
	const source = new EventSource(`/api/instances/${encodeURIComponent(state.activeId)}/events`);
	state.eventSource = source;
	source.addEventListener("open", () => {
		setConnection("online", "Connected");
	});
	source.addEventListener("snapshot", (event) => {
		handleEvent(JSON.parse(event.data));
	});
	source.addEventListener("message", (event) => {
		handleEvent(JSON.parse(event.data));
	});
	source.addEventListener("error", () => {
		if (state.eventSource === source) {
			setConnection(navigator.onLine ? "error" : "offline", navigator.onLine ? "Reconnecting" : "Offline");
		}
	});
}

async function rpc(command, { quiet = false } = {}) {
	if (!state.activeId) {
		throw new Error("Start or select an agent first.");
	}
	try {
		const data = await api(`/api/instances/${encodeURIComponent(state.activeId)}/messages`, {
			method: "POST",
			body: command,
		});
		if (data.response) {
			applyRpcResponse(data.response);
			if (!data.response.success) {
				throw new Error(data.response.error || `${command.type} failed`);
			}
		}
		return data.response;
	} catch (error) {
		if (error.status === 409) {
			setConnection("error", "In use");
		}
		if (!quiet) {
			toast(error.message, "error");
		}
		throw error;
	}
}

async function refreshInstance() {
	if (!state.activeId) {
		return;
	}
	setConnection("connecting", "Syncing");
	const commands = [
		{ type: "get_state" },
		{ type: "get_messages" },
		{ type: "get_available_models" },
		{ type: "get_available_thinking_levels" },
		{ type: "get_commands" },
	];
	const results = await Promise.allSettled(commands.map((command) => rpc(command, { quiet: true })));
	if (results.some((result) => result.status === "fulfilled")) {
		setConnection("online", "Connected");
	}
	const failure = results.find((result) => result.status === "rejected");
	if (failure && results.every((result) => result.status === "rejected")) {
		toast(failure.reason.message, "error");
	}
}

function rememberResponse(id) {
	if (!id) {
		return false;
	}
	if (state.seenResponses.has(id)) {
		return true;
	}
	state.seenResponses.add(id);
	if (state.seenResponses.size > 160) {
		state.seenResponses.delete(state.seenResponses.values().next().value);
	}
	return false;
}

function applyRpcResponse(response) {
	if (!response || response.type !== "response" || rememberResponse(response.id)) {
		return;
	}
	if (!response.success) {
		toast(response.error || `${response.command} failed`, "error");
		return;
	}
	const data = response.data;
	switch (response.command) {
		case "get_state":
			applySessionState(data);
			break;
		case "get_messages":
			renderMessages(data?.messages || []);
			break;
		case "get_available_models":
			state.models = data?.models || [];
			renderModels();
			break;
		case "get_available_thinking_levels":
			state.thinkingLevels = data?.levels || [];
			renderThinkingLevels();
			break;
		case "get_commands":
			state.commands = data?.commands || [];
			renderCommands();
			break;
		case "set_model":
			state.model = data || state.model;
			updateRuntimeLabels();
			renderModels();
			break;
		case "cycle_model":
			state.model = data?.model || state.model;
			if (data?.thinkingLevel) {
				state.thinkingLevel = data.thinkingLevel;
			}
			updateRuntimeLabels();
			break;
		case "set_thinking_level":
			updateRuntimeLabels();
			break;
		case "bash":
			finishBashCard(data, false);
			break;
		case "new_session":
			if (!data?.cancelled) {
				clearTranscript();
				void refreshInstance();
			}
			break;
	}
}

function applySessionState(session) {
	if (!session) {
		return;
	}
	state.model = session.model || null;
	state.thinkingLevel = session.thinkingLevel || "off";
	state.isStreaming = Boolean(session.isStreaming);
	elements.sessionState.textContent = session.isCompacting ? "Compacting" : state.isStreaming ? "Working" : "Ready";
	elements.sessionName.textContent = session.sessionName || session.sessionId?.slice(0, 12) || "Current session";
	const pending = Number(session.pendingMessageCount || 0);
	elements.queueCount.hidden = pending === 0;
	elements.queueCount.textContent = `${pending} queued`;
	updateRuntimeLabels();
	updateComposer();
}

function updateRuntimeLabels() {
	const model = state.model;
	elements.modelLabel.textContent = model
		? model.name || model.modelId || model.id || `${model.provider || ""}/${model.modelId || model.id || ""}`
		: "Not selected";
	elements.thinkingLabel.textContent = state.thinkingLevel || "off";
}

function clearTranscript() {
	for (const child of [...elements.transcript.children]) {
		if (child !== elements.emptyState) {
			child.remove();
		}
	}
	elements.emptyState.hidden = false;
	state.toolCards.clear();
	streamingMessage = null;
	streamingText = "";
	activeBashCard = null;
}

function renderMessages(messages) {
	clearTranscript();
	for (const message of messages) {
		if (message?.role === "toolResult") {
			const card = createToolCard(message.toolCallId || crypto.randomUUID(), message.toolName || "tool", "");
			updateToolCard(card, message.content, message.isError ? "error" : "done");
		} else {
			appendMessage(message);
		}
	}
	scrollLatest(false);
}

function roleLabel(role) {
	switch (role) {
		case "assistant":
			return "Pi";
		case "user":
			return "You";
		case "bashExecution":
			return "Shell";
		default:
			return "System";
	}
}

function appendMessage(message, { streaming = false } = {}) {
	if (!message) {
		return null;
	}
	elements.emptyState.hidden = true;
	const fragment = byId("message-template").content.cloneNode(true);
	const article = fragment.querySelector(".message");
	const author = fragment.querySelector(".message-author");
	const time = fragment.querySelector("time");
	const body = fragment.querySelector(".message-body");
	const role = message.role || "system";
	article.dataset.role = role;
	author.textContent = roleLabel(role);
	time.textContent = formatTime(message.timestamp);
	renderContent(body, message.content ?? message.text ?? message.message ?? "");
	if (streaming) {
		article.dataset.streaming = "true";
		body.classList.add("streaming-caret");
	}
	elements.transcript.append(fragment);
	scrollLatest(true);
	return elements.transcript.lastElementChild;
}

function formatTime(timestamp) {
	const date = timestamp ? new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000) : new Date();
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function renderContent(container, content) {
	container.replaceChildren();
	const blocks = Array.isArray(content) ? content : [{ type: "text", text: String(content || "") }];
	for (const block of blocks) {
		if (typeof block === "string") {
			appendFormattedText(container, block);
			continue;
		}
		switch (block?.type) {
			case "text":
				appendFormattedText(container, block.text || "");
				break;
			case "thinking": {
				const thinking = document.createElement("div");
				thinking.className = "thinking-block";
				thinking.textContent = block.thinking || block.text || "";
				container.append(thinking);
				break;
			}
			case "toolCall":
			case "tool_call":
				createToolCard(
					block.id || block.toolCallId || crypto.randomUUID(),
					block.name || "tool",
					block.arguments || block.input,
				);
				break;
			case "image": {
				const note = document.createElement("p");
				note.textContent = "Image attachment";
				container.append(note);
				break;
			}
			default:
				appendFormattedText(container, textFromContent(block));
		}
	}
}

function appendFormattedText(container, value) {
	const text = String(value || "");
	const pieces = text.split(/(```[\s\S]*?```)/g);
	for (const piece of pieces) {
		if (!piece) {
			continue;
		}
		if (piece.startsWith("```") && piece.endsWith("```")) {
			const firstBreak = piece.indexOf("\n");
			const codeText = firstBreak === -1 ? piece.slice(3, -3) : piece.slice(firstBreak + 1, -3);
			const pre = document.createElement("pre");
			const code = document.createElement("code");
			code.textContent = codeText.replace(/\n$/, "");
			pre.append(code);
			container.append(pre);
			continue;
		}
		for (const paragraph of piece.split(/\n{2,}/)) {
			if (!paragraph) {
				continue;
			}
			const node = document.createElement("p");
			const inline = paragraph.split(/(`[^`\n]+`)/g);
			for (const segment of inline) {
				if (segment.startsWith("`") && segment.endsWith("`")) {
					const code = document.createElement("code");
					code.className = "inline-code";
					code.textContent = segment.slice(1, -1);
					node.append(code);
				} else {
					node.append(document.createTextNode(segment));
				}
			}
			container.append(node);
		}
	}
}

function textFromContent(value) {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(textFromContent).filter(Boolean).join("\n");
	}
	if (typeof value === "object") {
		if (typeof value.text === "string") {
			return value.text;
		}
		if (typeof value.thinking === "string") {
			return value.thinking;
		}
		if (value.content !== undefined) {
			return textFromContent(value.content);
		}
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

function createToolCard(id, name, args) {
	const existing = state.toolCards.get(id);
	if (existing) {
		return existing;
	}
	elements.emptyState.hidden = true;
	const fragment = byId("tool-template").content.cloneNode(true);
	const card = fragment.querySelector(".tool-card");
	card.dataset.state = "running";
	card.querySelector("strong").textContent = name || "tool";
	card.querySelector("small").textContent = summarize(args) || "Running";
	card.querySelector("code").textContent = args ? textFromContent(args) : "";
	elements.transcript.append(fragment);
	const inserted = elements.transcript.lastElementChild;
	state.toolCards.set(id, inserted);
	scrollLatest(true);
	return inserted;
}

function summarize(value) {
	const text = textFromContent(value).replace(/\s+/g, " ").trim();
	return text.length > 72 ? `${text.slice(0, 69)}…` : text;
}

function updateToolCard(card, output, status = "running") {
	if (!card) {
		return;
	}
	card.dataset.state = status;
	card.querySelector("small").textContent = status === "done" ? "Completed" : status === "error" ? "Failed" : "Running";
	const text = textFromContent(output);
	if (text) {
		card.querySelector("code").textContent = text;
	}
	scrollLatest(true);
}

function updateStreamingMessage(message) {
	const text = textFromContent(message?.content ?? message);
	if (!streamingMessage) {
		streamingText = text;
		streamingMessage = appendMessage({ role: "assistant", content: text }, { streaming: true });
		return;
	}
	streamingText = text || streamingText;
	renderContent(streamingMessage.querySelector(".message-body"), streamingText);
	streamingMessage.querySelector(".message-body").classList.add("streaming-caret");
	scrollLatest(true);
}

function finishStreamingMessage(message) {
	if (streamingMessage) {
		const body = streamingMessage.querySelector(".message-body");
		body.classList.remove("streaming-caret");
		if (message) {
			renderContent(body, message.content ?? message);
		}
		delete streamingMessage.dataset.streaming;
		streamingMessage = null;
		streamingText = "";
	} else if (message?.role === "assistant") {
		appendMessage(message);
	}
}

function ensureBashCard(command = "Shell command") {
	if (!activeBashCard) {
		activeBashCard = createToolCard(`bash_${Date.now()}`, command, "");
	}
	return activeBashCard;
}

function finishBashCard(result, isError) {
	const card = ensureBashCard();
	updateToolCard(card, result, isError || result?.exitCode ? "error" : "done");
	state.bashRunning = false;
	activeBashCard = null;
	updateComposer();
}

function handleEvent(event) {
	if (!event || typeof event !== "object") {
		return;
	}
	if (event.type === "response") {
		applyRpcResponse(event);
		return;
	}
	if (event.type === "instance_snapshot" && event.instance) {
		state.instances = state.instances.map((item) => (item.id === event.instance.id ? event.instance : item));
		renderInstances();
		return;
	}
	if (event.type === "instance_status") {
		state.instances = state.instances.map((item) =>
			item.id === event.instanceId ? { ...item, status: event.status } : item,
		);
		renderInstances();
		if (event.instanceId === state.activeId) {
			setConnection(event.status === "online" ? "online" : "error", event.status);
		}
		return;
	}
	if (event.type === "extension_ui_request") {
		handleExtensionRequest(event);
		return;
	}

	switch (event.type) {
		case "agent_start":
			state.isStreaming = true;
			elements.sessionState.textContent = "Working";
			updateComposer();
			break;
		case "agent_end":
			if (event.messages?.length) {
				const last = event.messages[event.messages.length - 1];
				if (last?.role === "assistant") {
					finishStreamingMessage(last);
				}
			}
			break;
		case "agent_settled":
			state.isStreaming = false;
			elements.sessionState.textContent = "Ready";
			finishStreamingMessage();
			updateComposer();
			announce("Pi finished responding.");
			break;
		case "message_update":
			updateStreamingMessage(event.message || event.assistantMessageEvent?.partial || "");
			break;
		case "message_end":
			finishStreamingMessage(event.message);
			break;
		case "tool_execution_start":
			createToolCard(event.toolCallId || event.id, event.toolName || event.name, event.args);
			break;
		case "tool_execution_update": {
			const card = createToolCard(event.toolCallId || event.id, event.toolName || event.name, event.args);
			updateToolCard(card, event.partialResult || event.result, "running");
			break;
		}
		case "tool_execution_end": {
			const card = createToolCard(event.toolCallId || event.id, event.toolName || event.name, event.args);
			updateToolCard(card, event.result, event.isError ? "error" : "done");
			break;
		}
		case "bash_execution_update": {
			const card = ensureBashCard();
			const code = card.querySelector("code");
			code.textContent += event.delta || "";
			scrollLatest(true);
			break;
		}
		case "queue_update": {
			const count = (event.steering?.length || 0) + (event.followUp?.length || 0);
			elements.queueCount.hidden = count === 0;
			elements.queueCount.textContent = `${count} queued`;
			break;
		}
		case "session_info_changed":
			elements.sessionName.textContent = event.name || "Current session";
			break;
		case "thinking_level_changed":
			state.thinkingLevel = event.level;
			updateRuntimeLabels();
			renderThinkingLevels();
			break;
		case "compaction_start":
			elements.sessionState.textContent = "Compacting";
			appendMessage({ role: "system", content: `Compacting context (${event.reason}).` });
			break;
		case "compaction_end":
			elements.sessionState.textContent = event.aborted ? "Compaction stopped" : "Ready";
			break;
		case "auto_retry_start":
			appendMessage({
				role: "system",
				content: `Retry ${event.attempt} of ${event.maxAttempts} in ${Math.ceil((event.delayMs || 0) / 1000)}s.`,
			});
			break;
		case "auto_retry_end":
			if (!event.success && event.finalError) {
				toast(event.finalError, "error");
			}
			break;
	}
}

async function refreshModels() {
	if (modelRefreshPromise) {
		return modelRefreshPromise;
	}
	elements.modelList.replaceChildren();
	const loading = document.createElement("p");
	loading.className = "empty-list";
	loading.textContent = "Loading models…";
	elements.modelList.append(loading);
	modelRefreshPromise = (async () => {
		try {
			const response = await rpc({ type: "get_available_models" }, { quiet: true });
			if (response?.data?.models) {
				state.models = response.data.models;
			} else if (Array.isArray(response)) {
				state.models = response;
			}
			renderModels();
		} catch (error) {
			state.models = [];
			elements.modelList.replaceChildren();
			const msg = document.createElement("p");
			msg.className = "empty-list error";
			msg.textContent = error?.message || "Model discovery failed.";
			elements.modelList.append(msg);
			const retry = document.createElement("button");
			retry.className = "retry-button";
			retry.type = "button";
			retry.textContent = "Retry";
			retry.addEventListener("click", () => {
				modelRefreshPromise = null;
				void refreshModels();
			});
			elements.modelList.append(retry);
		} finally {
			modelRefreshPromise = null;
		}
	})();
	return modelRefreshPromise;
}

function renderModels() {
	elements.modelList.replaceChildren();
	if (!state.models.length) {
		renderEmpty(elements.modelList, "No models available.");
		return;
	}
	for (const model of state.models) {
		const modelId = model.modelId || model.id;
		const provider = model.provider || "";
		const name = model.name || modelId;
		const selected =
			state.model && (state.model.modelId || state.model.id) === modelId && state.model.provider === provider;
		const button = optionButton(name, provider ? `${provider} · ${modelId}` : modelId, selected);
		button.addEventListener("click", async () => {
			try {
				await rpc({ type: "set_model", provider, modelId });
				state.model = model;
				updateRuntimeLabels();
				renderModels();
				closeSheets();
			} catch {
				// rpc already surfaced the error.
			}
		});
		elements.modelList.append(button);
	}
}

function renderThinkingLevels() {
	elements.thinkingList.replaceChildren();
	const levels = state.thinkingLevels.length
		? state.thinkingLevels
		: ["off", "minimal", "low", "medium", "high", "xhigh"];
	for (const level of levels) {
		const button = optionButton(level, `Use ${level} reasoning`, level === state.thinkingLevel);
		button.addEventListener("click", async () => {
			try {
				await rpc({ type: "set_thinking_level", level });
				state.thinkingLevel = level;
				updateRuntimeLabels();
				renderThinkingLevels();
				closeSheets();
			} catch {
				// rpc already surfaced the error.
			}
		});
		elements.thinkingList.append(button);
	}
}

function optionButton(title, detail, selected) {
	const button = document.createElement("button");
	button.className = "option-item";
	button.type = "button";
	button.dataset.selected = String(selected);
	const copy = document.createElement("span");
	const strong = document.createElement("strong");
	const small = document.createElement("small");
	strong.textContent = title || "Unknown";
	small.textContent = detail || "";
	copy.append(strong, small);
	const check = document.createElement("span");
	check.className = "option-check";
	check.textContent = selected ? "✓" : "";
	check.setAttribute("aria-hidden", "true");
	button.append(copy, check);
	return button;
}

function renderCommands(filter = "") {
	elements.commandList.replaceChildren();
	const needle = filter.trim().toLowerCase();
	const commands = state.commands.filter((command) =>
		`${command.name} ${command.description || ""}`.toLowerCase().includes(needle),
	);
	if (!commands.length) {
		renderEmpty(elements.commandList, needle ? "No matching commands." : "No extension, prompt, or skill commands.");
		return;
	}
	for (const command of commands) {
		const button = document.createElement("button");
		button.className = "command-item";
		button.type = "button";
		const copy = document.createElement("span");
		const name = document.createElement("code");
		const description = document.createElement("small");
		name.textContent = `/${command.name}`;
		description.textContent = command.description || "Insert command";
		copy.append(name, description);
		const source = document.createElement("span");
		source.className = "command-source";
		source.textContent = command.source || "command";
		button.append(copy, source);
		button.addEventListener("click", () => {
			elements.composer.value = `/${command.name} `;
			saveDraft();
			autoSizeComposer();
			updateComposer();
			closeSheets();
			elements.composer.focus();
		});
		elements.commandList.append(button);
	}
}

function renderEmpty(container, text) {
	const empty = document.createElement("p");
	empty.className = "empty-list";
	empty.textContent = text;
	container.append(empty);
}

function setMode(mode) {
	state.mode = mode;
	for (const button of elements.modeStrip.querySelectorAll("[data-mode]")) {
		button.setAttribute("aria-selected", String(button.dataset.mode === mode));
	}
	elements.shellNotice.hidden = mode !== "bash";
	elements.composer.placeholder = mode === "bash" ? "Run one non-interactive command…" : "Message Pi…";
	updateComposer();
}

function updateComposer() {
	const text = elements.composer.value.trim();
	const hasInput = Boolean(text) || (state.mode !== "bash" && state.attachments.length > 0);
	elements.sendButton.disabled = !state.activeId || !navigator.onLine || !hasInput || state.bashRunning;
	elements.sendButton.setAttribute("aria-label", state.mode === "bash" ? "Run shell command" : `Send ${state.mode}`);
	elements.abortButton.hidden = !(state.isStreaming || state.bashRunning);
	elements.imageInput.disabled = state.mode === "bash";
}

async function submitComposer() {
	if (elements.sendButton.disabled) {
		return;
	}
	const text = elements.composer.value.trim();
	if (state.mode === "bash" && state.attachments.length) {
		toast("Images can be sent with Prompt, Steer, or Follow-up—not Shell.", "warning");
		return;
	}
	if (!navigator.onLine) {
		toast("You are offline. The draft was kept and was not executed.", "warning");
		return;
	}

	const attachments = state.attachments.map(({ mimeType, data }) => ({ type: "image", mimeType, data }));
	const displayText = text || `${attachments.length} image attachment${attachments.length === 1 ? "" : "s"}`;
	const mode = state.mode;
	if (mode === "bash") {
		state.bashRunning = true;
		activeBashCard = createToolCard(`bash_${Date.now()}`, displayText, "");
		appendMessage({ role: "bashExecution", content: `$ ${displayText}` });
	} else {
		appendMessage({ role: "user", content: displayText });
	}

	elements.composer.value = "";
	localStorage.removeItem(draftKey());
	clearAttachments();
	autoSizeComposer();
	updateComposer();

	try {
		if (mode === "bash") {
			await rpc({ type: "bash", command: text });
		} else {
			await rpc({ type: mode, message: text || "Please inspect the attached image.", images: attachments });
		}
	} catch {
		if (mode === "bash") {
			finishBashCard("The shell command failed before completing.", true);
		}
	}
}

async function abortCurrent() {
	try {
		await rpc({ type: state.bashRunning ? "abort_bash" : "abort" });
		if (state.bashRunning) {
			finishBashCard("Aborted by the controller.", true);
		}
	} catch {
		// rpc already surfaced the error.
	}
}

function autoSizeComposer() {
	elements.composer.style.height = "auto";
	elements.composer.style.height = `${Math.min(elements.composer.scrollHeight, 150)}px`;
}

async function addImages(files) {
	const available = 3 - state.attachments.length;
	if (available <= 0) {
		toast("Remove an image before attaching another. The limit is three.", "warning");
		return;
	}
	const selected = [...files].slice(0, available);
	if (files.length > available) {
		toast(`Only ${available} more image${available === 1 ? "" : "s"} can be attached.`, "warning");
	}
	elements.imageInput.disabled = true;
	for (const file of selected) {
		try {
			const attachment = await prepareImage(file);
			state.attachments.push(attachment);
		} catch (error) {
			toast(`${file.name}: ${error.message}`, "error");
		}
	}
	elements.imageInput.value = "";
	elements.imageInput.disabled = state.mode === "bash";
	renderAttachments();
	updateComposer();
}

async function prepareImage(file) {
	const allowed = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
	if (!allowed.has(file.type)) {
		throw new Error("use JPEG, PNG, WebP, or GIF");
	}
	if (file.type === "image/gif") {
		if (file.size > 640 * 1024) {
			throw new Error("GIF must be 640 KiB or smaller");
		}
		return attachmentFromBlob(file, file.name);
	}

	const image = await loadImage(file);
	let width = image.naturalWidth;
	let height = image.naturalHeight;
	const maxDimension = 1600;
	const scale = Math.min(1, maxDimension / Math.max(width, height));
	width = Math.max(1, Math.round(width * scale));
	height = Math.max(1, Math.round(height * scale));

	let quality = 0.84;
	let blob;
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d", { alpha: false });
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, width, height);
		context.drawImage(image, 0, 0, width, height);
		blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
		if (blob && blob.size <= 620 * 1024) {
			break;
		}
		quality = Math.max(0.5, quality - 0.08);
		if (attempt >= 3) {
			width = Math.max(1, Math.round(width * 0.82));
			height = Math.max(1, Math.round(height * 0.82));
		}
	}
	URL.revokeObjectURL(image.src);
	if (!blob || blob.size > 640 * 1024) {
		throw new Error("could not compress below 640 KiB");
	}
	return attachmentFromBlob(blob, `${file.name.replace(/\.[^.]+$/, "")}.jpg`);
}

function loadImage(file) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => {
			URL.revokeObjectURL(image.src);
			reject(new Error("could not decode this image"));
		};
		image.src = URL.createObjectURL(file);
	});
}

async function attachmentFromBlob(blob, name) {
	const dataUrl = await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error("could not read this image"));
		reader.readAsDataURL(blob);
	});
	return {
		data: String(dataUrl).split(",", 2)[1],
		mimeType: blob.type,
		name,
		previewUrl: URL.createObjectURL(blob),
		size: blob.size,
	};
}

function renderAttachments() {
	elements.attachmentRail.replaceChildren();
	elements.attachmentRail.hidden = state.attachments.length === 0;
	state.attachments.forEach((attachment, index) => {
		const chip = document.createElement("div");
		chip.className = "attachment-chip";
		const image = document.createElement("img");
		image.src = attachment.previewUrl;
		image.alt = "";
		const name = document.createElement("span");
		name.textContent = attachment.name;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.textContent = "×";
		remove.setAttribute("aria-label", `Remove ${attachment.name}`);
		remove.addEventListener("click", () => {
			const [removed] = state.attachments.splice(index, 1);
			URL.revokeObjectURL(removed.previewUrl);
			renderAttachments();
			updateComposer();
		});
		chip.append(image, name, remove);
		elements.attachmentRail.append(chip);
	});
}

function clearAttachments() {
	for (const attachment of state.attachments) {
		URL.revokeObjectURL(attachment.previewUrl);
	}
	state.attachments = [];
	renderAttachments();
}

function handleExtensionRequest(request) {
	switch (request.method) {
		case "notify":
			toast(
				request.message,
				request.notifyType === "error" ? "error" : request.notifyType === "warning" ? "warning" : "info",
			);
			return;
		case "setStatus":
			setWidget(elements.widgetAbove, request.statusText ? `${request.statusKey}: ${request.statusText}` : "");
			return;
		case "setWidget": {
			const target = request.widgetPlacement === "belowEditor" ? elements.widgetBelow : elements.widgetAbove;
			setWidget(target, request.widgetLines?.join("\n") || "");
			return;
		}
		case "setTitle":
			document.title = request.title ? `${request.title} · Pi Pocket` : "Pi Pocket Console";
			return;
		case "set_editor_text":
			elements.composer.value = request.text || "";
			saveDraft();
			autoSizeComposer();
			updateComposer();
			return;
		case "select":
		case "confirm":
		case "input":
		case "editor":
			openExtensionDialog(request);
			return;
	}
}

function setWidget(element, text) {
	element.textContent = text;
	element.hidden = !text;
}

function openExtensionDialog(request) {
	clearTimeout(state.extensionTimer);
	state.extensionRequest = request;
	elements.extensionTitle.textContent = request.title || "Input required";
	elements.extensionMessage.textContent = request.message || "";
	elements.extensionMessage.hidden = !request.message;
	elements.extensionFields.replaceChildren();
	elements.extensionSubmit.textContent = request.method === "confirm" ? "Confirm" : "Continue";

	if (request.method === "select") {
		const options = document.createElement("div");
		options.className = "extension-options";
		(request.options || []).forEach((option, index) => {
			const label = document.createElement("label");
			const input = document.createElement("input");
			input.type = "radio";
			input.name = "extension-value";
			input.value = option;
			input.required = true;
			input.checked = index === 0;
			const copy = document.createElement("span");
			copy.textContent = option;
			label.append(input, copy);
			options.append(label);
		});
		elements.extensionFields.append(options);
	} else if (request.method === "input") {
		const input = document.createElement("input");
		input.name = "extension-value";
		input.type = "text";
		input.placeholder = request.placeholder || "";
		input.autocomplete = "off";
		elements.extensionFields.append(input);
	} else if (request.method === "editor") {
		const input = document.createElement("textarea");
		input.name = "extension-value";
		input.value = request.prefill || "";
		elements.extensionFields.append(input);
	}

	if (!elements.extensionDialog.open) {
		elements.extensionDialog.showModal();
	}
	const input = elements.extensionFields.querySelector("input:not([type=radio]), textarea, input[type=radio]:checked");
	input?.focus();
	if (request.timeout) {
		state.extensionTimer = window.setTimeout(() => void cancelExtension(), request.timeout);
	}
}

async function submitExtension(event) {
	event.preventDefault();
	const request = state.extensionRequest;
	if (!request) {
		return;
	}
	let response;
	if (request.method === "confirm") {
		response = { type: "extension_ui_response", id: request.id, confirmed: true };
	} else {
		const selected = elements.extensionFields.querySelector(
			'input[name="extension-value"]:checked, input[name="extension-value"], textarea[name="extension-value"]',
		);
		response = { type: "extension_ui_response", id: request.id, value: selected?.value || "" };
	}
	await sendExtensionResponse(response);
}

async function cancelExtension() {
	const request = state.extensionRequest;
	if (!request) {
		return;
	}
	await sendExtensionResponse({ type: "extension_ui_response", id: request.id, cancelled: true });
}

async function sendExtensionResponse(response) {
	try {
		await api(`/api/instances/${encodeURIComponent(state.activeId)}/ui-responses`, {
			method: "POST",
			body: response,
		});
	} catch (error) {
		toast(error.message, "error");
	} finally {
		clearTimeout(state.extensionTimer);
		state.extensionTimer = null;
		state.extensionRequest = null;
		elements.extensionDialog.close();
	}
}

function openSheet(dialog) {
	if (!dialog || dialog.open) {
		return;
	}
	closeSheets();
	elements.sheetBackdrop.hidden = false;
	dialog.showModal();
	dialog.querySelector("button, input")?.focus();
}

function closeSheets() {
	for (const dialog of document.querySelectorAll("dialog.sheet[open]")) {
		dialog.close();
	}
	elements.sheetBackdrop.hidden = true;
}

function scrollLatest(smooth = true) {
	const distance = elements.transcript.scrollHeight - elements.transcript.scrollTop - elements.transcript.clientHeight;
	if (distance < 120 || !smooth) {
		elements.transcript.scrollTo({
			top: elements.transcript.scrollHeight,
			behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
		});
	}
}

function updateJumpButton() {
	const distance = elements.transcript.scrollHeight - elements.transcript.scrollTop - elements.transcript.clientHeight;
	elements.jumpLatest.hidden = distance < 160;
}

function syncViewportHeight() {
	const height = window.visualViewport?.height || window.innerHeight;
	document.documentElement.style.setProperty("--viewport-height", `${Math.round(height)}px`);
}

function setupInstallPrompt() {
	const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
	elements.installButton.hidden = standalone;
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		state.deferredInstall = event;
		elements.installButton.hidden = false;
	});
	elements.installButton.addEventListener("click", async () => {
		if (state.deferredInstall) {
			state.deferredInstall.prompt();
			await state.deferredInstall.userChoice;
			state.deferredInstall = null;
			elements.installButton.hidden = true;
		} else {
			toast("In Safari: tap More or Share, Add to Home Screen, then enable Open as Web App.", "info", 7000);
		}
	});
}

function bindEvents() {
	elements.pairForm.addEventListener("submit", pair);
	byId("step1-continue").addEventListener("click", () => showPairStep(2));
	byId("step2-back").addEventListener("click", () => showPairStep(1));
	byId("step3-confirm").addEventListener("click", async () => {
		try {
			await bootstrap();
			announce("This iPhone is paired.");
		} catch (error) {
			toast(error.message, "error");
			showPairStep(2);
		}
	});
	byId("step3-cancel").addEventListener("click", () => {
		state.csrfToken = "";
		showPairStep(1);
	});
	elements.pairCode.addEventListener("input", () => {
		elements.pairCode.value = formatPairCode(elements.pairCode.value);
		elements.pairError.textContent = "";
	});
	elements.spawnForm.addEventListener("submit", spawnInstance);
	elements.instanceButton.addEventListener("click", () => openSheet(byId("instance-sheet")));
	byId("more-button").addEventListener("click", () => openSheet(byId("controls-sheet")));
	elements.commandsButton.addEventListener("click", () => openSheet(byId("commands-sheet")));
	elements.modelButton.addEventListener("click", () => {
		openSheet(byId("model-sheet"));
		void refreshModels();
	});
	elements.thinkingButton.addEventListener("click", () => openSheet(byId("thinking-sheet")));
	elements.sheetBackdrop.addEventListener("click", closeSheets);
	for (const button of document.querySelectorAll(".sheet-close")) {
		button.addEventListener("click", closeSheets);
	}
	for (const dialog of document.querySelectorAll("dialog.sheet")) {
		dialog.addEventListener("close", () => {
			if (!document.querySelector("dialog.sheet[open]")) {
				elements.sheetBackdrop.hidden = true;
			}
		});
	}
	for (const button of elements.modeStrip.querySelectorAll("[data-mode]")) {
		button.addEventListener("click", () => setMode(button.dataset.mode));
	}
	for (const button of document.querySelectorAll("[data-nav]")) {
		button.addEventListener("click", () => {
			for (const item of document.querySelectorAll("[data-nav]")) {
				item.removeAttribute("aria-current");
			}
			button.setAttribute("aria-current", "page");
			const target = button.dataset.nav;
			if (target === "shell") {
				setMode("bash");
				elements.composer.focus();
			} else if (target === "chat") {
				setMode("prompt");
			} else if (target === "agents") {
				openSheet(byId("instance-sheet"));
			} else if (target === "controls") {
				openSheet(byId("controls-sheet"));
			}
		});
	}
	for (const button of document.querySelectorAll("[data-suggestion]")) {
		button.addEventListener("click", () => {
			elements.composer.value = button.dataset.suggestion;
			saveDraft();
			autoSizeComposer();
			updateComposer();
			elements.composer.focus();
		});
	}
	elements.commandSearch.addEventListener("input", () => renderCommands(elements.commandSearch.value));
	elements.composer.addEventListener("input", () => {
		saveDraft();
		autoSizeComposer();
		updateComposer();
	});
	elements.composer.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void submitComposer();
		}
	});
	elements.sendButton.addEventListener("click", () => void submitComposer());
	elements.abortButton.addEventListener("click", () => void abortCurrent());
	elements.imageInput.addEventListener("change", () => void addImages(elements.imageInput.files || []));
	elements.jumpLatest.addEventListener("click", () => scrollLatest(false));
	elements.transcript.addEventListener("scroll", updateJumpButton, { passive: true });
	byId("retry-button").addEventListener("click", () => {
		connectEvents();
		void refreshInstance();
	});
	byId("refresh-button").addEventListener("click", () => {
		closeSheets();
		void refreshInstance();
	});
	byId("new-session-button").addEventListener("click", async () => {
		if (!window.confirm("Start a new Pi session? The current session remains on the host.")) {
			return;
		}
		closeSheets();
		try {
			await rpc({ type: "new_session" });
		} catch {
			// rpc already surfaced the error.
		}
	});
	elements.extensionForm.addEventListener("submit", (event) => void submitExtension(event));
	byId("extension-cancel").addEventListener("click", () => void cancelExtension());
	byId("extension-cancel-x").addEventListener("click", () => void cancelExtension());
	elements.extensionDialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		void cancelExtension();
	});

	window.addEventListener("online", () => {
		setConnection("connecting", "Reconnecting");
		connectEvents();
		void refreshInstance();
		updateComposer();
	});
	window.addEventListener("offline", () => {
		setConnection("offline", "Offline");
		updateComposer();
	});
	window.addEventListener("pageshow", () => {
		if (state.activeId) {
			void refreshInstance();
		}
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible" && state.activeId) {
			void refreshInstance();
		}
	});
	window.addEventListener("resize", syncViewportHeight, { passive: true });
	window.visualViewport?.addEventListener("resize", syncViewportHeight, { passive: true });
	window.visualViewport?.addEventListener("scroll", syncViewportHeight, { passive: true });
}

async function initialize() {
	bindEvents();
	setupInstallPrompt();
	setMode("prompt");
	syncViewportHeight();
	if ("serviceWorker" in navigator && (window.isSecureContext || location.hostname === "127.0.0.1")) {
		navigator.serviceWorker.register("/sw.js").catch(() => {
			// The connected experience remains available if installation is blocked.
		});
	}
	await bootstrap();
}

void initialize();
