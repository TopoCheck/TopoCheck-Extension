import { IModule } from "./interfaces/IModule";

export class ModuleRegistry {
    private modules = new Map<string, IModule>();

    register(module: IModule): void {
        this.modules.set(module.name, module);
    }

    get(name: string): IModule | undefined {
        return this.modules.get(name);
    }

    initializeAll(): void {
        for (const module of this.modules.values()) {
            module.initialize();
        }
    }
}