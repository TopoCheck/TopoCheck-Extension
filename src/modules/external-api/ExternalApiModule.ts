import { IModule } from "../../core/interfaces/IModule";

export class ExternalApiModule implements IModule {
    name = "external-api";

    initialize(): void {
        console.log("External API module initialized");
    }
}