export interface NormalizedModel {
	provider: string;
	modelId: string;
	name: string;
	contextWindow: number;
	reasoning: boolean;
}

export function normalizeModel(raw: unknown): NormalizedModel | undefined {
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const provider = obj.provider;
	const modelId = obj.modelId ?? obj.id;
	if (typeof provider !== "string" || !provider) {
		return undefined;
	}
	if (typeof modelId !== "string" || !modelId) {
		return undefined;
	}
	return {
		provider,
		modelId,
		name: typeof obj.name === "string" && obj.name ? obj.name : modelId,
		contextWindow: typeof obj.contextWindow === "number" ? obj.contextWindow : 0,
		reasoning: obj.reasoning === true,
	};
}

export function normalizeModelList(raw: unknown): NormalizedModel[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const result: NormalizedModel[] = [];
	for (const item of raw) {
		const normalized = normalizeModel(item);
		if (!normalized) {
			continue;
		}
		const key = `${normalized.provider}:${normalized.modelId}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

export function isValidModelSelection(provider: unknown, modelId: unknown, available: NormalizedModel[]): boolean {
	if (typeof provider !== "string" || !provider) {
		return false;
	}
	if (typeof modelId !== "string" || !modelId) {
		return false;
	}
	return available.some((m) => m.provider === provider && m.modelId === modelId);
}
