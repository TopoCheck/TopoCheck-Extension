import { IModule } from "../../core/interfaces/IModule";

export class ConfigModule implements IModule {
    name = "config";

    initialize(): void {
        console.log("Config module initialized");
    }
}