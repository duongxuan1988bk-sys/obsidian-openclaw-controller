export type OpenClawCatalogOption = {
  value: string;
  label: string;
  description?: string;
};

export type OpenClawCatalog = {
  agents: OpenClawCatalogOption[];
  models: OpenClawCatalogOption[];
  agentDefaults: Record<string, string | undefined>;
};

type FsLike = {
  promises: {
    readFile(path: string, encoding: string): Promise<string>;
  };
};

type OsLike = {
  homedir(): string;
};

type PathLike = {
  join(...parts: string[]): string;
};

function getNodeRequire(): ((id: string) => any) | null {
  const fromGlobal = (globalThis as any).require;
  if (typeof fromGlobal === "function") return fromGlobal;
  try {
    return (0, eval)("require") as (id: string) => any;
  } catch {
    return null;
  }
}

export async function loadLocalOpenClawCatalog(): Promise<OpenClawCatalog> {
  const req = getNodeRequire();
  if (!req) throw new Error("Node runtime is unavailable");

  const fs = req("fs") as FsLike;
  const os = req("os") as OsLike;
  const path = req("path") as PathLike;

  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await fs.promises.readFile(configPath, "utf8");
  const obj = JSON.parse(raw) as Record<string, unknown>;

  const providers = (((obj.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined) ?? {});
  const models: OpenClawCatalogOption[] = [];
  for (const [providerId, providerValue] of Object.entries(providers)) {
    const provider = providerValue as Record<string, unknown>;
    const providerModels = Array.isArray(provider.models) ? provider.models : [];
    for (const modelValue of providerModels) {
      const model = modelValue as Record<string, unknown>;
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) continue;
      const name = typeof model.name === "string" ? model.name : id;
      models.push({
        value: `${providerId}/${id}`,
        label: name,
        description: providerId
      });
    }
  }

  const agentList = ((((obj.agents as Record<string, unknown> | undefined)?.list as unknown[]) ?? []) as Array<Record<string, unknown>>);
  const agents: OpenClawCatalogOption[] = agentList
    .map((agent) => {
      const id = typeof agent.id === "string" ? agent.id : "";
      const name = typeof agent.name === "string" ? agent.name : id;
      const model = typeof agent.model === "string" ? agent.model : undefined;
      return {
        value: id,
        label: name || id,
        description: model
      };
    })
    .filter((agent) => agent.value);

  const agentDefaults: Record<string, string | undefined> = {};
  for (const agent of agentList) {
    const id = typeof agent.id === "string" ? agent.id : "";
    const model = typeof agent.model === "string" ? agent.model : undefined;
    if (id) agentDefaults[id] = model;
  }

  return { agents, models, agentDefaults };
}
