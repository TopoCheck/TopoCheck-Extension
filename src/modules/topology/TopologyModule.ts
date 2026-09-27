import { IModule } from "../../core/interfaces/IModule";

export class TopologyModule implements IModule {
    name = "topology";

    initialize(): void {
        console.log("Topology module initialized");
    }
}