import { IModule } from "../../core/interfaces/IModule";

export class DiagnosticsModule implements IModule {
    name = "diagnostics";

    initialize(): void {
        console.log("Diagnostics module initialized");
    }
}